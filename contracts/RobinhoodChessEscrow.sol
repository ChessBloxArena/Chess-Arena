// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Native ETH chess wagers on Robinhood Chain.
/// @dev The result authority declares the result; players pull ETH before any optional wallet swap.
contract RobinhoodChessEscrow {
    enum State {
        None,
        Created,
        Active,
        Settled,
        Draw,
        Cancelled,
        Paid
    }

    struct Contest {
        address creator;
        address joiner;
        address winner;
        uint128 stake;
        uint64 expiresAt;
        bytes32 resultHash;
        State state;
        uint8 drawClaims;
    }

    error Unauthorized();
    error InvalidAddress();
    error InvalidContest();
    error InvalidState();
    error InvalidStake();
    error InvalidExpiry();
    error TransferFailed();
    error Reentrancy();

    address public immutable resultAuthority;
    mapping(bytes32 => Contest) private contests;
    uint256 private locked = 1;

    event ContestCreated(bytes32 indexed contestId, address indexed creator, uint256 stake, uint64 expiresAt);
    event ContestJoined(bytes32 indexed contestId, address indexed joiner);
    event ContestSettled(bytes32 indexed contestId, address indexed winner, bytes32 resultHash, bool draw);
    event ContestCancelled(bytes32 indexed contestId);
    event EthClaimed(bytes32 indexed contestId, address indexed recipient, uint256 amount);

    modifier nonReentrant() {
        if (locked != 1) revert Reentrancy();
        locked = 2;
        _;
        locked = 1;
    }

    constructor(address resultAuthority_) {
        if (resultAuthority_ == address(0)) revert InvalidAddress();
        resultAuthority = resultAuthority_;
    }

    function createContest(bytes32 contestId, uint64 expiresAt) external payable {
        if (contestId == bytes32(0) || contests[contestId].state != State.None) revert InvalidContest();
        if (msg.value == 0 || msg.value > type(uint128).max) revert InvalidStake();
        if (expiresAt <= block.timestamp || expiresAt > block.timestamp + 30 days) revert InvalidExpiry();

        contests[contestId] = Contest({
            creator: msg.sender,
            joiner: address(0),
            winner: address(0),
            stake: uint128(msg.value),
            expiresAt: expiresAt,
            resultHash: bytes32(0),
            state: State.Created,
            drawClaims: 0
        });
        emit ContestCreated(contestId, msg.sender, msg.value, expiresAt);
    }

    function joinContest(bytes32 contestId) external payable {
        Contest storage contest = contests[contestId];
        if (contest.state != State.Created) revert InvalidState();
        if (block.timestamp >= contest.expiresAt || msg.sender == contest.creator) revert InvalidContest();
        if (msg.value != contest.stake) revert InvalidStake();
        contest.joiner = msg.sender;
        contest.state = State.Active;
        emit ContestJoined(contestId, msg.sender);
    }

    function settleContest(bytes32 contestId, address winner, bytes32 resultHash) external {
        if (msg.sender != resultAuthority) revert Unauthorized();
        Contest storage contest = contests[contestId];
        if (contest.state != State.Active || resultHash == bytes32(0)) revert InvalidState();
        if (winner != address(0) && winner != contest.creator && winner != contest.joiner) revert InvalidAddress();
        contest.winner = winner;
        contest.resultHash = resultHash;
        contest.state = winner == address(0) ? State.Draw : State.Settled;
        emit ContestSettled(contestId, winner, resultHash, winner == address(0));
    }

    function cancelUnmatched(bytes32 contestId) external nonReentrant {
        Contest storage contest = contests[contestId];
        if (contest.state != State.Created || msg.sender != contest.creator) revert Unauthorized();
        uint256 amount = contest.stake;
        contest.state = State.Paid;
        emit ContestCancelled(contestId);
        _sendEth(contest.creator, amount);
    }

    function refundExpired(bytes32 contestId) external nonReentrant {
        Contest storage contest = contests[contestId];
        if (block.timestamp < contest.expiresAt) revert InvalidExpiry();
        if (contest.state == State.Created) {
            uint256 amount = contest.stake;
            contest.state = State.Paid;
            emit ContestCancelled(contestId);
            _sendEth(contest.creator, amount);
            return;
        }
        if (contest.state != State.Active) revert InvalidState();
        contest.state = State.Cancelled;
        emit ContestCancelled(contestId);
    }

    function claimEth(bytes32 contestId) external nonReentrant {
        Contest storage contest = contests[contestId];
        if (contest.state == State.Settled) {
            if (msg.sender != contest.winner) revert Unauthorized();
            uint256 amount = uint256(contest.stake) * 2;
            contest.state = State.Paid;
            _sendEth(msg.sender, amount);
            emit EthClaimed(contestId, msg.sender, amount);
            return;
        }
        if (contest.state == State.Draw || contest.state == State.Cancelled) {
            _claimRefund(contestId, contest, msg.sender);
            return;
        }
        revert InvalidState();
    }

    function getContest(bytes32 contestId) external view returns (Contest memory) {
        return contests[contestId];
    }

    function claimableAmount(bytes32 contestId, address account) external view returns (uint256) {
        Contest memory contest = contests[contestId];
        if (contest.state == State.Settled && account == contest.winner) return uint256(contest.stake) * 2;
        if (contest.state == State.Draw || contest.state == State.Cancelled) {
            if (account == contest.creator && contest.drawClaims & 1 == 0) return contest.stake;
            if (account == contest.joiner && contest.drawClaims & 2 == 0) return contest.stake;
        }
        return 0;
    }

    function _claimRefund(bytes32 contestId, Contest storage contest, address recipient) private {
        uint8 claimBit;
        if (recipient == contest.creator) claimBit = 1;
        else if (recipient == contest.joiner) claimBit = 2;
        else revert Unauthorized();
        if (contest.drawClaims & claimBit != 0) revert InvalidState();
        contest.drawClaims |= claimBit;
        if (contest.drawClaims == 3 || contest.joiner == address(0)) contest.state = State.Paid;
        uint256 amount = contest.stake;
        _sendEth(recipient, amount);
        emit EthClaimed(contestId, recipient, amount);
    }

    function _sendEth(address recipient, uint256 amount) private {
        (bool ok,) = payable(recipient).call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
