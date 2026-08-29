// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
contract MockRblx {
    mapping(address => uint256) public balanceOf;
    function mint(address to, uint256 amount) external { balanceOf[to] += amount; }
}
contract MockSwapRouter {
    MockRblx public immutable token;
    constructor(MockRblx token_) { token = token_; }
    function swap(address to, uint256 output) external payable { token.mint(to, output); }
    function fail() external payable { revert("NO_LIQUIDITY"); }
    function reenter(bytes calldata input) external payable {
        (bool ok,) = msg.sender.call(input);
        require(ok, "REENTRANCY_BLOCKED");
    }
}
