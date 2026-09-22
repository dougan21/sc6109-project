// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Permissionless forwarding of bounded, agent-signed ERC-20 transfers.
/// @dev Only standard, non-rebasing, non-fee tokens are supported. Batches are atomic.
contract AgentIntentExecutor is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Policy {
        address token;
        address recipient;
        uint256 maxAmountPerIntent;
        uint256 totalBudget;
        uint256 validUntil;
    }

    struct Authorization {
        address owner;
        address agent;
        address token;
        address recipient;
        uint256 maxAmountPerIntent;
        uint256 totalBudget;
        uint256 spent;
        uint256 validUntil;
        bool active;
        uint256 epoch;
    }

    struct TransferIntent {
        address owner;
        address agent;
        address token;
        address recipient;
        uint256 amount;
        uint256 nonce;
        uint256 epoch;
        uint256 validAfter;
        uint256 deadline;
    }

    bytes32 public constant TRANSFER_INTENT_TYPEHASH = keccak256(
        "TransferIntent(address owner,address agent,address token,address recipient,uint256 amount,uint256 nonce,uint256 epoch,uint256 validAfter,uint256 deadline)"
    );
    mapping(address => mapping(address => Authorization)) private policies;
    mapping(address => mapping(address => mapping(uint256 => mapping(uint256 => bool)))) public consumed;

    error InvalidPolicy();
    error InvalidBatch();
    error InactiveAuthorization();
    error WrongEpoch();
    error InvalidWindow();
    error PolicyViolation();
    error BudgetExceeded();
    error NonceConsumed();
    error InvalidSigner();

    event AgentConfigured(address indexed owner, address indexed agent, uint256 epoch, Policy policy);
    event AgentRevoked(address indexed owner, address indexed agent, uint256 epoch);
    event IntentExecuted(
        bytes32 indexed intentId, address indexed owner, address indexed agent, address recipient, uint256 amount
    );

    constructor() EIP712("AgentIntentExecutor", "1") {}

    /// @dev No owner argument: a caller can only change its own authorization namespace.
    function configureAgent(address agent, Policy calldata policy) external nonReentrant {
        if (
            agent == address(0) || agent.code.length != 0 || policy.token.code.length == 0
                || policy.recipient == address(0) || policy.maxAmountPerIntent == 0
                || policy.totalBudget < policy.maxAmountPerIntent || policy.validUntil <= block.timestamp
        ) revert InvalidPolicy();
        uint256 epoch = policies[msg.sender][agent].epoch + 1;
        policies[msg.sender][agent] = Authorization(
            msg.sender,
            agent,
            policy.token,
            policy.recipient,
            policy.maxAmountPerIntent,
            policy.totalBudget,
            0,
            policy.validUntil,
            true,
            epoch
        );
        emit AgentConfigured(msg.sender, agent, epoch, policy);
    }

    function revokeAgent(address agent) external nonReentrant {
        if (agent == address(0)) revert InvalidPolicy();
        Authorization storage policy = policies[msg.sender][agent];
        policy.active = false;
        policy.epoch += 1;
        emit AgentRevoked(msg.sender, agent, policy.epoch);
    }

    function getAgentPolicy(address owner, address agent) external view returns (Authorization memory) {
        return policies[owner][agent];
    }

    function hashIntent(TransferIntent calldata intent) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(TRANSFER_INTENT_TYPEHASH, intent)));
    }

    function executeBatch(TransferIntent[] calldata intents, bytes[] calldata signatures) external nonReentrant {
        if (intents.length == 0 || intents.length != signatures.length) revert InvalidBatch();
        for (uint256 i; i < intents.length; ++i) {
            TransferIntent calldata intent = intents[i];
            Authorization storage policy = policies[intent.owner][intent.agent];
            if (!policy.active || block.timestamp > policy.validUntil) revert InactiveAuthorization();
            if (intent.epoch != policy.epoch) revert WrongEpoch();
            if (intent.validAfter > block.timestamp || block.timestamp > intent.deadline) revert InvalidWindow();
            if (
                intent.token != policy.token || intent.recipient != policy.recipient || intent.amount == 0
                    || intent.amount > policy.maxAmountPerIntent
            ) revert PolicyViolation();
            if (intent.amount > policy.totalBudget - policy.spent) revert BudgetExceeded();
            if (consumed[intent.owner][intent.agent][intent.epoch][intent.nonce]) revert NonceConsumed();
            bytes32 intentId = hashIntent(intent);
            if (ECDSA.recover(intentId, signatures[i]) != intent.agent) revert InvalidSigner();
            consumed[intent.owner][intent.agent][intent.epoch][intent.nonce] = true;
            policy.spent += intent.amount;
            IERC20(intent.token).safeTransferFrom(intent.owner, intent.recipient, intent.amount);
            emit IntentExecuted(intentId, intent.owner, intent.agent, intent.recipient, intent.amount);
        }
    }
}
