// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {AgentIntentExecutor as Executor} from "../src/AgentIntentExecutor.sol";
import {MockToken} from "../src/MockToken.sol";
import {TokenDouble} from "./TokenDouble.sol";

interface Vm {
    function addr(uint256) external returns (address);
    function sign(uint256, bytes32) external returns (uint8, bytes32, bytes32);
    function prank(address) external;
    function warp(uint256) external;
    function chainId(uint256) external;
    function expectRevert(bytes4) external;
    function expectRevert() external;
    function expectEmit(bool, bool, bool, bool, address) external;
}

contract ExecutorTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 constant AGENT_KEY = 0xA11CE;
    address constant OWNER = address(0x100);
    address constant RECIPIENT = address(0x200);
    address agent;
    Executor executor;
    MockToken token;

    event IntentExecuted(
        bytes32 indexed intentId, address indexed owner, address indexed agent, address recipient, uint256 amount
    );

    function setUp() public {
        vm.warp(1000);
        agent = vm.addr(AGENT_KEY);
        executor = new Executor();
        token = new MockToken();
        token.mint(OWNER, 1000);
        vm.prank(OWNER);
        token.approve(address(executor), 1000);
        configure(100, 500, 2000);
    }

    function configure(uint256 limit, uint256 budget, uint256 expiry) internal {
        vm.prank(OWNER);
        executor.configureAgent(agent, Executor.Policy(address(token), RECIPIENT, limit, budget, expiry));
    }

    function intent(uint256 nonce, uint256 amount) internal view returns (Executor.TransferIntent memory) {
        return Executor.TransferIntent(
            OWNER,
            agent,
            address(token),
            RECIPIENT,
            amount,
            nonce,
            executor.getAgentPolicy(OWNER, agent).epoch,
            1000,
            1900
        );
    }

    function sign(Executor.TransferIntent memory item) internal returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(AGENT_KEY, executor.hashIntent(item));
        return abi.encodePacked(r, s, v);
    }

    function execute(Executor.TransferIntent memory item, bytes memory signature) internal {
        Executor.TransferIntent[] memory items = new Executor.TransferIntent[](1);
        bytes[] memory signatures = new bytes[](1);
        items[0] = item;
        signatures[0] = signature;
        executor.executeBatch(items, signatures);
    }

    function assertUntouched(uint256 nonce) internal view {
        require(token.balanceOf(OWNER) == 1000 && token.balanceOf(RECIPIENT) == 0, "balances changed");
        require(executor.getAgentPolicy(OWNER, agent).spent == 0, "spent changed");
        require(!executor.consumed(OWNER, agent, 1, nonce), "nonce changed");
    }

    function reject(Executor.TransferIntent memory item, bytes4 error) internal {
        bytes memory signature = sign(item);
        vm.expectRevert(error);
        execute(item, signature);
        assertUntouched(item.nonce);
    }

    function testSingleTransferEmitsDigestAndUpdatesState() public {
        Executor.TransferIntent memory item = intent(0, 100);
        bytes memory signature = sign(item);
        vm.expectEmit(true, true, true, true, address(executor));
        emit IntentExecuted(executor.hashIntent(item), OWNER, agent, RECIPIENT, 100);
        execute(item, signature);
        require(token.balanceOf(OWNER) == 900 && token.balanceOf(RECIPIENT) == 100, "transfer");
        require(executor.getAgentPolicy(OWNER, agent).spent == 100, "spent");
        require(executor.consumed(OWNER, agent, 1, 0), "nonce");
    }

    function testCallerCannotModifyAnotherOwnersPolicy() public {
        executor.configureAgent(agent, Executor.Policy(address(token), address(0xBAD), 1, 1, 2000));
        executor.revokeAgent(agent);
        Executor.Authorization memory policy = executor.getAgentPolicy(OWNER, agent);
        require(policy.active && policy.epoch == 1 && policy.recipient == RECIPIENT, "owner namespace changed");
        Executor.TransferIntent memory item = intent(0, 1);
        execute(item, sign(item));
        require(token.balanceOf(RECIPIENT) == 1, "owner policy no longer usable");
    }

    function testTamperedAmountRejected() public {
        Executor.TransferIntent memory item = intent(0, 1);
        bytes memory signature = sign(item);
        item.amount = 2;
        vm.expectRevert(Executor.InvalidSigner.selector);
        execute(item, signature);
        assertUntouched(0);
    }

    function testWrongSignerRejected() public {
        Executor.TransferIntent memory item = intent(0, 1);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(123, executor.hashIntent(item));
        vm.expectRevert(Executor.InvalidSigner.selector);
        execute(item, abi.encodePacked(r, s, v));
        assertUntouched(0);
    }

    function testMalformedSignatureRejected() public {
        Executor.TransferIntent memory item = intent(0, 1);
        vm.expectRevert();
        execute(item, hex"abcd");
        assertUntouched(0);
    }

    function testWrongChainRejected() public {
        Executor.TransferIntent memory item = intent(0, 1);
        bytes memory signature = sign(item);
        vm.chainId(block.chainid + 1);
        vm.expectRevert(Executor.InvalidSigner.selector);
        execute(item, signature);
        assertUntouched(0);
    }

    function testWrongVerifyingContractRejected() public {
        Executor.TransferIntent memory item = intent(0, 1);
        Executor other = new Executor();
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(AGENT_KEY, other.hashIntent(item));
        vm.expectRevert(Executor.InvalidSigner.selector);
        execute(item, abi.encodePacked(r, s, v));
        assertUntouched(0);
    }

    function testReplayRejected() public {
        Executor.TransferIntent memory item = intent(42, 100);
        bytes memory signature = sign(item);
        execute(item, signature);
        vm.expectRevert(Executor.NonceConsumed.selector);
        execute(item, signature);
        require(token.balanceOf(RECIPIENT) == 100 && executor.getAgentPolicy(OWNER, agent).spent == 100, "replay");
    }

    function testRevocationAndReauthorizationInvalidateOldSignatures() public {
        Executor.TransferIntent memory item = intent(0, 100);
        bytes memory signature = sign(item);
        execute(item, signature);
        vm.prank(OWNER);
        executor.revokeAgent(agent);
        vm.expectRevert(Executor.InactiveAuthorization.selector);
        execute(item, signature);
        configure(100, 500, 2000);
        require(executor.getAgentPolicy(OWNER, agent).epoch == 3, "epoch");
        require(executor.getAgentPolicy(OWNER, agent).spent == 0, "fresh budget");
        vm.expectRevert(Executor.WrongEpoch.selector);
        execute(item, signature);
        item.epoch = 3;
        execute(item, sign(item));
        require(token.balanceOf(RECIPIENT) == 200 && executor.consumed(OWNER, agent, 3, 0), "fresh nonce scope");
    }

    function testConfigurationUpdateInvalidatesPendingIntent() public {
        Executor.TransferIntent memory item = intent(0, 1);
        configure(100, 500, 2000);
        reject(item, Executor.WrongEpoch.selector);
    }

    function testTooEarlyRejected() public {
        Executor.TransferIntent memory item = intent(0, 1);
        item.validAfter = 1001;
        reject(item, Executor.InvalidWindow.selector);
    }

    function testExpiredIntentRejected() public {
        vm.warp(1901);
        reject(intent(0, 1), Executor.InvalidWindow.selector);
    }

    function testExpiredAuthorizationRejected() public {
        vm.warp(2001);
        reject(intent(0, 1), Executor.InactiveAuthorization.selector);
    }

    function testInclusiveTimeBoundaries() public {
        Executor.TransferIntent memory item = intent(0, 1);
        item.validAfter = 2000;
        item.deadline = 2000;
        vm.warp(2000);
        execute(item, sign(item));
        require(token.balanceOf(RECIPIENT) == 1, "inclusive boundaries");
    }

    function testWrongTokenRejected() public {
        Executor.TransferIntent memory item = intent(0, 1);
        item.token = address(0xBAD);
        reject(item, Executor.PolicyViolation.selector);
    }

    function testWrongRecipientRejected() public {
        Executor.TransferIntent memory item = intent(0, 1);
        item.recipient = address(0xBAD);
        reject(item, Executor.PolicyViolation.selector);
    }

    function testZeroAmountRejected() public {
        reject(intent(0, 0), Executor.PolicyViolation.selector);
    }

    function testPerIntentLimitRejected() public {
        reject(intent(0, 101), Executor.PolicyViolation.selector);
    }

    function testInvalidPoliciesRejected() public {
        Executor.Policy memory policy = Executor.Policy(address(token), RECIPIENT, 100, 500, 2000);
        vm.expectRevert(Executor.InvalidPolicy.selector);
        executor.configureAgent(address(0), policy);
        vm.expectRevert(Executor.InvalidPolicy.selector);
        executor.configureAgent(address(token), policy);
        policy.token = address(0xBAD);
        vm.expectRevert(Executor.InvalidPolicy.selector);
        executor.configureAgent(agent, policy);
        policy.token = address(token);
        policy.recipient = address(0);
        vm.expectRevert(Executor.InvalidPolicy.selector);
        executor.configureAgent(agent, policy);
        policy.recipient = RECIPIENT;
        policy.maxAmountPerIntent = 0;
        vm.expectRevert(Executor.InvalidPolicy.selector);
        executor.configureAgent(agent, policy);
        policy.maxAmountPerIntent = 501;
        vm.expectRevert(Executor.InvalidPolicy.selector);
        executor.configureAgent(agent, policy);
        policy.maxAmountPerIntent = 100;
        policy.validUntil = 1000;
        vm.expectRevert(Executor.InvalidPolicy.selector);
        executor.configureAgent(agent, policy);
        require(executor.getAgentPolicy(OWNER, agent).epoch == 1, "invalid policy changed state");
    }

    function batch(uint256 secondNonce, uint256 secondAmount)
        internal
        returns (Executor.TransferIntent[] memory items, bytes[] memory signatures)
    {
        items = new Executor.TransferIntent[](2);
        signatures = new bytes[](2);
        items[0] = intent(5, 100);
        items[1] = intent(secondNonce, secondAmount);
        signatures[0] = sign(items[0]);
        signatures[1] = sign(items[1]);
    }

    function testDuplicateBatchRollsBack() public {
        (Executor.TransferIntent[] memory items, bytes[] memory signatures) = batch(5, 100);
        vm.expectRevert(Executor.NonceConsumed.selector);
        executor.executeBatch(items, signatures);
        assertUntouched(5);
    }

    function testLaterPolicyFailureRollsBack() public {
        (Executor.TransferIntent[] memory items, bytes[] memory signatures) = batch(6, 101);
        vm.expectRevert(Executor.PolicyViolation.selector);
        executor.executeBatch(items, signatures);
        assertUntouched(5);
        assertUntouched(6);
    }

    function testCumulativeBudgetFailureRollsBack() public {
        configure(100, 150, 2000);
        (Executor.TransferIntent[] memory items, bytes[] memory signatures) = batch(6, 100);
        vm.expectRevert(Executor.BudgetExceeded.selector);
        executor.executeBatch(items, signatures);
        assertUntouched(5);
        require(!executor.consumed(OWNER, agent, 2, 5), "epoch nonce changed");
    }

    function testInsufficientAllowanceRollsBackEarlierTransfer() public {
        vm.prank(OWNER);
        token.approve(address(executor), 150);
        (Executor.TransferIntent[] memory items, bytes[] memory signatures) = batch(6, 100);
        vm.expectRevert();
        executor.executeBatch(items, signatures);
        assertUntouched(5);
        require(token.allowance(OWNER, address(executor)) == 150, "allowance changed");
    }

    function testInsufficientBalanceRollsBackEarlierTransfer() public {
        vm.prank(OWNER);
        token.transfer(address(0x300), 850);
        (Executor.TransferIntent[] memory items, bytes[] memory signatures) = batch(6, 100);
        vm.expectRevert();
        executor.executeBatch(items, signatures);
        require(token.balanceOf(OWNER) == 150 && token.balanceOf(RECIPIENT) == 0, "balance rollback");
        require(
            executor.getAgentPolicy(OWNER, agent).spent == 0 && !executor.consumed(OWNER, agent, 1, 5), "state rollback"
        );
    }

    function testEmptyAndMismatchedBatchesRejected() public {
        Executor.TransferIntent[] memory items = new Executor.TransferIntent[](0);
        bytes[] memory signatures = new bytes[](0);
        vm.expectRevert(Executor.InvalidBatch.selector);
        executor.executeBatch(items, signatures);
        items = new Executor.TransferIntent[](1);
        vm.expectRevert(Executor.InvalidBatch.selector);
        executor.executeBatch(items, signatures);
        assertUntouched(0);
    }

    function testFuzzBatchMatchesSinglesAndConservesBalances(uint8 a, uint8 b) public {
        uint256 first = uint256(a) % 100 + 1;
        uint256 second = uint256(b) % 100 + 1;
        (Executor.TransferIntent[] memory items, bytes[] memory signatures) = batch(2, second);
        items[0].amount = first;
        signatures[0] = sign(items[0]);
        executor.executeBatch(items, signatures);
        uint256 batched = token.balanceOf(RECIPIENT);
        require(batched == first + second && token.balanceOf(OWNER) + batched == 1000, "conservation");
        require(executor.getAgentPolicy(OWNER, agent).spent == batched && batched <= 500, "budget");
        require(executor.consumed(OWNER, agent, 1, 5) && executor.consumed(OWNER, agent, 1, 2), "unordered nonces");
        setUp();
        items[0] = intent(5, first);
        items[1] = intent(2, second);
        execute(items[0], sign(items[0]));
        execute(items[1], sign(items[1]));
        require(token.balanceOf(RECIPIENT) == batched, "singles differ");
    }

    function testTokenReturnValuesAndReentrancyGuard() public {
        for (uint256 mode = 1; mode <= 3; ++mode) {
            TokenDouble double = new TokenDouble(mode, OWNER);
            vm.prank(OWNER);
            double.approve(address(executor), 1000);
            vm.prank(OWNER);
            executor.configureAgent(agent, Executor.Policy(address(double), RECIPIENT, 100, 500, 2000));
            Executor.TransferIntent memory item = intent(0, 100);
            item.token = address(double);
            bytes memory signature = sign(item);
            double.setCallback(address(executor), abi.encodeCall(executor.revokeAgent, (agent)));
            if (mode == 1) {
                vm.expectRevert();
                execute(item, signature);
                require(
                    double.balanceOf(RECIPIENT) == 0 && executor.getAgentPolicy(OWNER, agent).spent == 0,
                    "false return accepted"
                );
                require(!executor.consumed(OWNER, agent, item.epoch, 0), "false return consumed nonce");
            } else {
                execute(item, signature);
                require(
                    double.balanceOf(RECIPIENT) == 100 && executor.getAgentPolicy(OWNER, agent).spent == 100,
                    "token handling"
                );
                if (mode == 2) require(double.blocked(), "reentrancy not blocked");
            }
        }
    }

    function testFuzzBudgetAndReplayAcrossSequence(uint256 seed) public {
        uint256 expected;
        for (uint256 n; n < 12; ++n) {
            uint256 amount = uint256(keccak256(abi.encode(seed, n))) % 100 + 1;
            Executor.TransferIntent memory item = intent(n, amount);
            bytes memory signature = sign(item);
            if (expected + amount > 500) {
                vm.expectRevert(Executor.BudgetExceeded.selector);
                execute(item, signature);
                require(!executor.consumed(OWNER, agent, 1, n), "failed nonce consumed");
            } else {
                execute(item, signature);
                expected += amount;
                vm.expectRevert();
                execute(item, signature);
            }
            require(
                token.balanceOf(RECIPIENT) == expected && token.balanceOf(OWNER) == 1000 - expected, "sequence balance"
            );
            require(executor.getAgentPolicy(OWNER, agent).spent == expected && expected <= 500, "sequence budget");
        }
    }
}
