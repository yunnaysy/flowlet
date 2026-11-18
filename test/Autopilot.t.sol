// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Test, Vm} from "forge-std/Test.sol";
import {IReactive} from "@reactive/src/interfaces/IReactive.sol";
import {IPayable} from "@reactive/src/interfaces/IPayable.sol";
import {ISystemContract} from "@reactive/src/interfaces/ISystemContract.sol";
import {AbstractCallback} from "@reactive/src/base/AbstractCallback.sol";
import {AbstractPayer} from "@reactive/src/base/AbstractPayer.sol";

import {AutopilotVault} from "../src/AutopilotVault.sol";
import {AutopilotReactive} from "../src/AutopilotReactive.sol";
import {MockUSD} from "../src/MockUSD.sol";
import {MockSystem, MockCallbackProxy} from "./mocks/MockSystem.sol";

/// @notice End-to-end simulation of the full loop: origin event -> react() -> callback request -> proxy -> vault.
contract AutopilotTest is Test {
    address constant SYSTEM = 0x8888888888888888888888888888888888888888;
    address constant LEGACY = 0x0000000000000000000000000000000000fffFfF;
    uint256 constant CRON10 = 0x04463f7c1651e6b9774d7f85c85bb94654e3c46ca79b0c16fb16d4183307b687;
    uint256 constant CRON100 = 0xb49937fb8970e19fd46d48f7e3fb00d659deac0347f79cd7cb542f0fc1503c70;
    uint256 constant IGNORE = 0xa65f96fc951c35ead38878e0f0b7a3c744a6f5ccc1476b313353ce31712313ad;
    uint256 constant DEST = 84532;
    uint256 constant TRANSFER_TOPIC = uint256(keccak256("Transfer(address,address,uint256)"));

    MockSystem sys;
    MockCallbackProxy proxy;
    AutopilotReactive rc;
    AutopilotVault vault;
    MockUSD usd;

    address user = makeAddr("user");
    address landlord = makeAddr("landlord");
    address savings = makeAddr("savings");
    address employer = makeAddr("employer");

    uint256 delivered; // callbacks already delivered from the mock system queue

    function setUp() public {
        vm.warp(1_800_000_000);
        vm.etch(SYSTEM, address(new MockSystem()).code);
        sys = MockSystem(payable(SYSTEM));
        proxy = new MockCallbackProxy();
        usd = new MockUSD();

        rc = new AutopilotReactive(DEST, CRON10);
        vm.prank(user);
        vault = new AutopilotVault(IPayable(payable(address(proxy))), address(rc));
        rc.setVault(address(vault), user);

        usd.mint(user, 5_000e6);
        vm.prank(user);
        usd.approve(address(vault), 2_000e6);
    }

    // ------------------------------------------------------------ helpers

    /// Forward every log the vault/token emitted on the "destination chain" to react(), as Reactive would.
    function _relay(Vm.Log[] memory logs) internal {
        for (uint256 i = 0; i < logs.length; ++i) {
            Vm.Log memory l = logs[i];
            if (l.emitter != address(vault) && l.emitter != address(usd)) continue;
            uint256[4] memory t;
            for (uint256 j = 0; j < l.topics.length; ++j) {
                t[j] = uint256(l.topics[j]);
            }
            IReactive.LogRecord memory rec = IReactive.LogRecord({
                chainId: DEST,
                contractAddress: l.emitter,
                topic0: t[0],
                topic1: t[1],
                topic2: t[2],
                topic3: t[3],
                data: l.data,
                blockNumber: block.number,
                opCode: l.topics.length,
                blockHash: 0,
                txHash: uint256(keccak256(abi.encode("tx", i, block.timestamp))),
                logIndex: i
            });
            // Only deliver what the contract is actually subscribed to (as the network would).
            if (!_isSubscribed(rec)) continue;
            vm.prank(SYSTEM);
            rc.react(rec);
        }
    }

    function _isSubscribed(IReactive.LogRecord memory r) internal view returns (bool) {
        return sys.isSubscribed(address(rc), DEST, r.contractAddress, r.topic0, IGNORE, IGNORE, IGNORE)
            || sys.isSubscribed(address(rc), DEST, r.contractAddress, r.topic0, IGNORE, r.topic2, IGNORE);
    }

    function _cron() internal {
        IReactive.LogRecord memory rec;
        rec.chainId = block.chainid;
        rec.contractAddress = LEGACY;
        rec.topic0 = rc.cronTopic();
        rec.opCode = 1;
        rec.data = abi.encode(block.number);
        vm.prank(SYSTEM);
        rc.react(rec);
    }

    /// Deliver pending callback requests through the proxy, relaying the resulting logs back.
    function _deliverCallbacks() internal {
        uint256 n = sys.callbackCount();
        while (delivered < n) {
            ISystemContract.CallbackConfiguration_V_1_0 memory c = sys.callbackAt(delivered++);
            assertEq(c.chainId, DEST);
            assertEq(c.recipient, address(vault));
            vm.recordLogs();
            proxy.deliver(c.recipient, c.payload, address(rc));
            _relay(vm.getRecordedLogs());
        }
    }

    function _createOrder(uint128 amount, uint64 interval, uint32 maxRuns) internal returns (uint256 id) {
        vm.recordLogs();
        vm.prank(user);
        id = vault.createOrder(address(usd), landlord, amount, interval, 0, maxRuns);
        _relay(vm.getRecordedLogs());
    }

    // -------------------------------------------------------------- tests

    function test_setVaultSubscribesToVaultEvents() public view {
        uint256 t = uint256(keccak256("OrderScheduled(uint256,address,address,uint256,uint64,uint64,uint32)"));
        assertTrue(sys.isSubscribed(address(rc), DEST, address(vault), t, IGNORE, IGNORE, IGNORE));
        assertFalse(rc.cronSubscribed(), "idle autopilot must not pay for cron");
    }

    function test_fullLoop_standingOrder() public {
        uint256 id = _createOrder(100e6, 60, 3);
        assertTrue(rc.cronSubscribed(), "cron turns on with first order");
        assertEq(rc.activeOrderIds().length, 1);

        // Due immediately (+ grace).
        vm.warp(block.timestamp + 3);
        _cron();
        assertEq(sys.callbackCount(), 1);
        _deliverCallbacks();
        assertEq(usd.balanceOf(landlord), 100e6);
        (uint64 nextDue,,) = rc.mirror(id);
        assertEq(nextDue, vault.getOrder(id).nextDue, "mirror follows vault");

        // Ticks before due do nothing.
        vm.warp(block.timestamp + 30);
        _cron();
        assertEq(sys.callbackCount(), 1);

        // Two more runs complete the order and cron switches itself off.
        for (uint256 k = 0; k < 2; ++k) {
            vm.warp(vault.getOrder(id).nextDue + 3);
            _cron();
            _deliverCallbacks();
        }
        assertEq(usd.balanceOf(landlord), 300e6);
        assertFalse(vault.getOrder(id).active);
        assertEq(rc.activeOrderIds().length, 0);
        assertFalse(rc.cronSubscribed(), "cron turns off when nothing is left");
    }

    function test_pendingPreventsDuplicateRequests() public {
        _createOrder(10e6, 60, 0);
        vm.warp(block.timestamp + 3);
        _cron();
        _cron(); // callback not delivered yet
        assertEq(sys.callbackCount(), 1);
        vm.warp(block.timestamp + 91); // pending timeout -> retry
        _cron();
        assertEq(sys.callbackCount(), 2);
        // Both delivered: the vault pays once, second is ignored as NOT_DUE.
        _deliverCallbacks();
        assertEq(usd.balanceOf(landlord), 10e6);
    }

    function test_batchesDueOrders() public {
        _createOrder(1e6, 60, 0);
        _createOrder(2e6, 60, 0);
        _createOrder(3e6, 60, 0);
        vm.warp(block.timestamp + 3);
        _cron();
        assertEq(sys.callbackCount(), 1, "one callback for three orders");
        _deliverCallbacks();
        assertEq(usd.balanceOf(landlord), 6e6);
    }

    function test_noCatchUpBurstAfterDowntime() public {
        uint256 id = _createOrder(1e6, 60, 0);
        vm.warp(block.timestamp + 1 days);
        _cron();
        _deliverCallbacks();
        assertEq(usd.balanceOf(landlord), 1e6);
        assertEq(vault.getOrder(id).nextDue, block.timestamp + 60);
    }

    function test_failedPaymentRetriesThenCloses() public {
        vm.prank(user);
        usd.approve(address(vault), 0); // allowance revoked -> pulls fail
        uint256 id = _createOrder(1e6, 60, 0);
        for (uint256 k = 0; k < 3; ++k) {
            vm.warp(vault.getOrder(id).nextDue + 3);
            _cron();
            _deliverCallbacks();
        }
        assertFalse(vault.getOrder(id).active);
        assertEq(vault.getOrder(id).failures, 3);
        assertFalse(rc.cronSubscribed());
    }

    function test_cancelStopsMirrorAndCron() public {
        uint256 id = _createOrder(1e6, 60, 0);
        vm.recordLogs();
        vm.prank(user);
        vault.cancelOrder(id);
        _relay(vm.getRecordedLogs());
        assertEq(rc.activeOrderIds().length, 0);
        assertFalse(rc.cronSubscribed());
    }

    function test_fullLoop_autoSaveSweep() public {
        vm.recordLogs();
        vm.prank(user);
        vault.configureSweep(address(usd), savings, 50e6, 2_000, true); // save 20% of deposits >= 50 tUSD
        _relay(vm.getRecordedLogs());
        assertTrue(rc.sweepSubscribed());
        assertTrue(
            sys.isSubscribed(
                address(rc), DEST, address(usd), TRANSFER_TOPIC, IGNORE, uint256(uint160(user)), IGNORE
            )
        );

        // Small deposit: ignored by the reactive contract (no callback, no cost on destination).
        vm.recordLogs();
        vm.prank(employer);
        usd.mint(user, 10e6);
        _relay(vm.getRecordedLogs());
        assertEq(sys.callbackCount(), 0);

        // Salary lands -> 20% swept to savings.
        vm.recordLogs();
        usd.mint(user, 1_000e6);
        _relay(vm.getRecordedLogs());
        assertEq(sys.callbackCount(), 1);
        _deliverCallbacks();
        assertEq(usd.balanceOf(savings), 200e6);
        assertEq(rc.sweepRequests(), 1, "sweep's own Transfer (to savings) must not loop");
    }

    function test_sweepIsIdempotent() public {
        vm.prank(user);
        vault.configureSweep(address(usd), savings, 1, 1_000, true);
        bytes memory p = abi.encodeWithSignature(
            "sweep(address,address,uint256,bytes32,uint256)",
            address(0),
            address(usd),
            100e6,
            bytes32("tx"),
            1
        );
        proxy.deliver(address(vault), p, address(rc));
        proxy.deliver(address(vault), p, address(rc));
        assertEq(usd.balanceOf(savings), 10e6);
    }

    function test_disableSweepUnsubscribes() public {
        vm.recordLogs();
        vm.prank(user);
        vault.configureSweep(address(usd), savings, 1, 1_000, true);
        vm.prank(user);
        vault.configureSweep(address(0), address(0), 0, 0, false);
        _relay(vm.getRecordedLogs());
        assertFalse(rc.sweepSubscribed());
        assertEq(sys.unsubscribeCalls(), 1);
    }

    function test_setCronTopicResubscribes() public {
        _createOrder(1e6, 60, 0);
        rc.setCronTopic(CRON100);
        assertTrue(sys.isSubscribed(address(rc), block.chainid, LEGACY, CRON100, IGNORE, IGNORE, IGNORE));
        assertFalse(sys.isSubscribed(address(rc), block.chainid, LEGACY, CRON10, IGNORE, IGNORE, IGNORE));
    }

    // --------------------------------------------------------- security

    function test_reactOnlySystem() public {
        IReactive.LogRecord memory rec;
        vm.expectRevert(abi.encodeWithSelector(AbstractPayer.NotAuthorized.selector, address(this), SYSTEM));
        rc.react(rec);
    }

    function test_vaultRejectsDirectCalls() public {
        uint256[] memory ids = new uint256[](0);
        vm.expectRevert(
            abi.encodeWithSelector(AbstractPayer.NotAuthorized.selector, address(this), address(proxy))
        );
        vault.executeDue(address(rc), ids);
    }

    function test_vaultRejectsForeignReactiveContract() public {
        bytes memory p =
            abi.encodeWithSignature("executeDue(address,uint256[])", address(0), new uint256[](0));
        address evil = makeAddr("evilReactive");
        vm.expectRevert(); // CallbackNotAuthorized bubbles as "callback reverted"
        proxy.deliver(address(vault), p, evil);
    }

    function test_onlyOwnerConfigures() public {
        vm.expectRevert(AutopilotVault.NotOwner.selector);
        vault.createOrder(address(usd), landlord, 1, 60, 0, 0);
        vm.prank(user);
        vm.expectRevert(AutopilotReactive.NotOwner.selector);
        rc.setCronTopic(CRON100);
    }

    function test_rejectsBadRules() public {
        vm.startPrank(user);
        vm.expectRevert(AutopilotVault.BadRule.selector);
        vault.createOrder(address(usd), landlord, 1, 5, 0, 0); // interval too short
        vm.expectRevert(AutopilotVault.BadRule.selector);
        vault.createOrder(address(usd), user, 1, 60, 0, 0); // paying yourself would loop with sweep
        vm.expectRevert(AutopilotVault.BadRule.selector);
        vault.configureSweep(address(usd), user, 1, 1000, true); // savings == wallet
        vm.stopPrank();
    }

    function testFuzz_sweepAmount(uint96 incoming, uint16 bps) public {
        bps = uint16(bound(bps, 1, 10_000));
        incoming = uint96(bound(incoming, 1, 2_000e6));
        vm.prank(user);
        vault.configureSweep(address(usd), savings, 1, bps, true);
        bytes memory p = abi.encodeWithSignature(
            "sweep(address,address,uint256,bytes32,uint256)",
            address(0),
            address(usd),
            uint256(incoming),
            bytes32("x"),
            0
        );
        proxy.deliver(address(vault), p, address(rc));
        assertEq(usd.balanceOf(savings), (uint256(incoming) * bps) / 10_000);
    }
}
