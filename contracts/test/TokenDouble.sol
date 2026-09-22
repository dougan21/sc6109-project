// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Test-only token for return-value handling and callback attempts.
contract TokenDouble is ERC20 {
    uint256 public mode;
    address public target;
    bytes public callback;
    bool public blocked;

    constructor(uint256 mode_, address owner) ERC20("Double", "DBL") {
        mode = mode_;
        _mint(owner, 1000);
    }

    function setCallback(address target_, bytes calldata callback_) external {
        target = target_;
        callback = callback_;
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        if (mode == 1) return false;
        if (mode == 2) {
            (bool ok, bytes memory result) = target.call(callback);
            blocked = !ok && bytes4(result) == bytes4(keccak256("ReentrancyGuardReentrantCall()"));
            require(blocked, "callback not guarded");
        }
        super.transferFrom(from, to, amount);
        if (mode == 3) {
            assembly { return(0, 0) }
        }
        return true;
    }
}
