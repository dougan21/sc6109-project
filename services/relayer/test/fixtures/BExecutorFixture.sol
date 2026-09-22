// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// TEST ONLY: validates B's provisional transport/signing/event contract.
// This is NOT A's executor: it has no token transfers, owner delegation, budgets, or production safety guarantees.
contract BExecutorFixture {
    struct TransferIntent {
        address owner; address agent; address token; address recipient;
        uint256 amount; uint256 nonce; uint256 epoch; uint256 validAfter; uint256 deadline;
    }
    bytes32 constant TYPE_HASH = keccak256("TransferIntent(address owner,address agent,address token,address recipient,uint256 amount,uint256 nonce,uint256 epoch,uint256 validAfter,uint256 deadline)");
    bytes32 public immutable DOMAIN_SEPARATOR;
    uint256 public executedCount;
    bool public forceFailure;
    mapping(bytes32 => bool) public consumed;
    event IntentExecuted(bytes32 indexed intentId, address indexed owner, address indexed agent, address recipient, uint256 amount);

    constructor() {
        DOMAIN_SEPARATOR = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("AgentIntentBatchExecutor"), keccak256("1"), block.chainid, address(this)));
    }
    function setForceFailure(bool value) external { forceFailure = value; }
    function executeBatch(TransferIntent[] calldata intents, bytes[] calldata signatures) external {
        require(!forceFailure, "forced failure");
        require(intents.length == signatures.length && intents.length > 0, "length");
        for (uint256 n; n < intents.length; n++) {
            TransferIntent calldata i = intents[n];
            require(block.timestamp >= i.validAfter && block.timestamp <= i.deadline, "time");
            bytes32 key = keccak256(abi.encode(i.owner, i.agent, i.epoch, i.nonce));
            require(!consumed[key], "nonce");
            bytes32 digest = keccak256(abi.encodePacked(hex"1901", DOMAIN_SEPARATOR, keccak256(abi.encode(TYPE_HASH, i))));
            bytes calldata sig = signatures[n];
            require(sig.length == 65, "signature length");
            bytes32 r; bytes32 s; uint8 v;
            assembly { r := calldataload(sig.offset) s := calldataload(add(sig.offset, 32)) v := byte(0, calldataload(add(sig.offset, 64))) }
            require(i.agent != address(0) && ecrecover(digest, v, r, s) == i.agent, "signer");
            require(i.amount != 13, "fixture invalid amount");
            consumed[key] = true; executedCount++;
            emit IntentExecuted(digest, i.owner, i.agent, i.recipient, i.amount);
        }
    }
}
