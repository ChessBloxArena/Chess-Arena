// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Native ETH chess wagers on Robinhood Chain.
/// @dev Entrants authorize a minimum RBLX prize. A relayer pays gas; ETH fallback unlocks after 15 minutes.
interface IRblxToken { function balanceOf(address account) external view returns (uint256); }
contract RobinhoodChessEscrowV2 {
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
    address public immutable swapRouter;
    IRblxToken public immutable rblxToken;
    uint256 public constant FALLBACK_DELAY = 15 minutes;
    struct Payout {
        uint256 whiteMinimum;
        uint256 blackMinimum;
        uint64 settledAt;
        uint8 asset; // 0 = pending, 1 = RBLX, 2 = ETH
        uint256 amount;
        uint256 paidBlock;
    }
    mapping(bytes32 => Payout) private payouts;
    error InvalidPayout();
    error SwapFailed();
    error MinimumNotMet();
    error FallbackNotReady();
    event PayoutAuthorized(bytes32 indexed contestId, address indexed player, uint256 minimumRblx);
    event PrizePaid(bytes32 indexed contestId, address indexed winner, uint8 asset, uint256 amount);
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

    constructor(address resultAuthority_, address swapRouter_, address rblxToken_) {
        if (resultAuthority_ == address(0)) revert InvalidAddress();
        if (swapRouter_.code.length == 0 || rblxToken_.code.length == 0) revert InvalidAddress();
        resultAuthority = resultAuthority_;
        swapRouter = swapRouter_;
        rblxToken = IRblxToken(rblxToken_);
    }

    function createRblxContest(bytes32 contestId, uint64 expiresAt, uint256 minimumRblx) external payable {
        if (minimumRblx == 0) revert InvalidPayout();
        payouts[contestId].whiteMinimum = minimumRblx;
        emit PayoutAuthorized(contestId, msg.sender, minimumRblx);
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

    function joinRblxContest(bytes32 contestId, uint256 minimumRblx) external payable {
        if (minimumRblx == 0) revert InvalidPayout();
        payouts[contestId].blackMinimum = minimumRblx;
        emit PayoutAuthorized(contestId, msg.sender, minimumRblx);
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
        payouts[contestId].settledAt = uint64(block.timestamp);
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
            _payEthFallback(contestId, contest);
            return;
        }
        if (contest.state == State.Draw || contest.state == State.Cancelled) {
            _claimRefund(contestId, contest, msg.sender);
            return;
        }
        revert InvalidState();
    }

    /// @notice Spend only this contest's pot; verify output at the winner, never an operator address.
    /// @dev No token approvals, delegatecall, or access to other contests' ETH. All swap effects revert on failure.
    function payRblx(bytes32 contestId, bytes calldata swapData, uint256 minimumOut, uint256 deadline) external nonReentrant {
        if (msg.sender != resultAuthority) revert Unauthorized();
        Contest storage contest = contests[contestId];
        Payout storage payout = payouts[contestId];
        if (contest.state != State.Settled || payout.asset != 0) revert InvalidState();
        if (block.timestamp >= uint256(payout.settledAt) + FALLBACK_DELAY) revert InvalidExpiry();
        if (deadline < block.timestamp || deadline > block.timestamp + 120) revert InvalidExpiry();
        uint256 authorizedMinimum = contest.winner == contest.creator ? payout.whiteMinimum : payout.blackMinimum;
        if (minimumOut < authorizedMinimum || authorizedMinimum == 0 || swapData.length < 4 || swapData.length > 16384) revert InvalidPayout();
        uint256 beforeBalance = rblxToken.balanceOf(contest.winner);
        uint256 pot = uint256(contest.stake) * 2;
        contest.state = State.Paid;
        // Calls are limited to the immutable router and exactly this contest's ETH pot.
        (bool ok,) = swapRouter.call{value: pot}(swapData);
        if (!ok) revert SwapFailed();
        uint256 afterBalance = rblxToken.balanceOf(contest.winner);
        if (afterBalance < beforeBalance || afterBalance - beforeBalance < minimumOut) revert MinimumNotMet();
        payout.asset = 1;
        payout.amount = afterBalance - beforeBalance;
        payout.paidBlock = block.number;
        emit PrizePaid(contestId, contest.winner, 1, payout.amount);
    }

    /// @notice Anyone may sponsor the winner's full ETH payout after the conversion window.
    function payEthFallback(bytes32 contestId) external nonReentrant {
        Contest storage contest = contests[contestId];
        if (contest.state != State.Settled) revert InvalidState();
        _payEthFallback(contestId, contest);
    }

    function _payEthFallback(bytes32 contestId, Contest storage contest) private {
        Payout storage payout = payouts[contestId];
        if (block.timestamp < uint256(payout.settledAt) + FALLBACK_DELAY) revert FallbackNotReady();
        uint256 amount = uint256(contest.stake) * 2;
        contest.state = State.Paid;
        payout.asset = 2;
        payout.amount = amount;
        payout.paidBlock = block.number;
        _sendEth(contest.winner, amount);
        emit EthClaimed(contestId, contest.winner, amount);
        emit PrizePaid(contestId, contest.winner, 2, amount);
    }

    function getPayout(bytes32 contestId) external view returns (Payout memory) {
        return payouts[contestId];
    }

    function getContest(bytes32 contestId) external view returns (Contest memory) {
        return contests[contestId];
    }

    function claimableAmount(bytes32 contestId, address account) external view returns (uint256) {
        Contest memory contest = contests[contestId];
        if (contest.state == State.Settled && account == contest.winner && block.timestamp >= uint256(payouts[contestId].settledAt) + FALLBACK_DELAY) return uint256(contest.stake) * 2;
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
