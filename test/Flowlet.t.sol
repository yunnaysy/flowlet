// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Test, Vm} from "forge-std/Test.sol";
import {IReactive} from "@reactive/src/interfaces/IReactive.sol";
import {IPayable} from "@reactive/src/interfaces/IPayable.sol";
import {ISystemContract} from "@reactive/src/interfaces/ISystemContract.sol";
import {AbstractPayer} from "@reactive/src/base/AbstractPayer.sol";

import {FlowletVault} from "../src/FlowletVault.sol";
import {FlowletReactive} from "../src/FlowletReactive.sol";
import {MockUSD} from "../src/MockUSD.sol";
import {MockSystem, MockCallbackProxy} from "./mocks/MockSystem.sol";

/// @notice Full-loop simulation: origin event -> react() -> callback request -> proxy -> vault -> events back.
contract FlowletTest is Test {
    address constant SYSTEM = 0x8888888888888888888888888888888888888888;
    address constant LEGACY = 0x0000000000000000000000000000000000fffFfF;
    uint256 constant CRON10 = 0x04463f7c1651e6b9774d7f85c85bb94654e3c46ca79b0c16fb16d4183307b687;
    uint256 constant CRON100 = 0xb49937fb8970e19fd46d48f7e3fb00d659deac0347f79cd7cb542f0fc1503c70;
    uint256 constant IGNORE = 0xa65f96fc951c35ead38878e0f0b7a3c744a6f5ccc1476b313353ce31712313ad;
    uint256 constant DEST = 84532;
    uint256 constant TRANSFER_TOPIC = uint256(keccak256("Transfer(address,address,uint256)"));
    bytes32 constant DECISION_TOPIC =
        keccak256("Decision(uint256,uint8,uint256,uint256,uint256,uint8,address)");

    MockSystem sys;
    MockCallbackProxy proxy;
    FlowletReactive rc;
    FlowletVault vault;
    MockUSD usd;

    address user = makeAddr("user");
    address landlord = makeAddr("landlord");
    address savings = makeAddr("savings");
    address employer = makeAddr("employer");

    uint256 delivered;
    uint256 txCounter;

    struct D {
        uint256 nonce;
        uint8 kind;
        uint256 ruleId;
        uint256 requested;
        uint256 executed;
        uint8 reason;
    }

    D[] decisions;

    function setUp() public {
        vm.warp(1_800_000_000);
        vm.etch(SYSTEM, address(new MockSystem()).code);
        sys = MockSystem(payable(SYSTEM));
        proxy = new MockCallbackProxy();
        usd = new MockUSD();

        rc = new FlowletReactive(DEST, CRON10);
        vm.prank(user);
        vault = new FlowletVault(IPayable(payable(address(proxy))), address(rc), address(usd));
        rc.setVault(address(vault), user, address(usd));

        usd.mint(user, 5_000e6);
        _asUser(abi.encodeCall(usd.approve, (address(vault), 2_000e6)), address(usd));
    }

    // ------------------------------------------------------------ helpers

    /// Execute a user transaction on the destination chain and relay its logs like Reactive would.
    function _asUser(bytes memory data, address to) internal {
        vm.recordLogs();
        vm.prank(user);
        (bool ok, bytes memory ret) = to.call(data);
        if (!ok) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
        _relay(vm.getRecordedLogs());
    }

    function _relay(Vm.Log[] memory logs) internal {
        bytes32 txh = keccak256(abi.encode("tx", ++txCounter));
        for (uint256 i = 0; i < logs.length; ++i) {
            Vm.Log memory l = logs[i];
            if (l.emitter == address(vault) && l.topics[0] == DECISION_TOPIC) {
                (uint256 req, uint256 exe, uint8 reason,) =
                    abi.decode(l.data, (uint256, uint256, uint8, address));
                decisions.push(
                    D(
                        uint256(l.topics[1]),
                        uint8(uint256(l.topics[2])),
                        uint256(l.topics[3]),
                        req,
                        exe,
                        reason
                    )
                );
            }
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
                txHash: uint256(txh),
                logIndex: i
            });
            if (!_isSubscribed(rec)) continue;
            vm.prank(SYSTEM);
            rc.react(rec);
        }
    }

    function _isSubscribed(IReactive.LogRecord memory r) internal view returns (bool) {
        address a = address(rc);
        return sys.isSubscribed(a, DEST, r.contractAddress, r.topic0, IGNORE, IGNORE, IGNORE)
            || sys.isSubscribed(a, DEST, r.contractAddress, r.topic0, IGNORE, r.topic2, IGNORE)
            || sys.isSubscribed(a, DEST, r.contractAddress, r.topic0, r.topic1, r.topic2, IGNORE);
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

    function _deliver() internal {
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
        id = vault.orderCount();
        _asUser(abi.encodeCall(vault.createOrder, (landlord, amount, interval, 0, maxRuns)), address(vault));
    }

    function _deposit(uint256 amount) internal {
        vm.recordLogs();
        vm.prank(employer);
        usd.mint(user, amount);
        _relay(vm.getRecordedLogs());
    }

    function _lastDecision() internal view returns (D memory) {
        return decisions[decisions.length - 1];
    }

    // ------------------------------------------------------- standing orders

    function test_idleCostsNothing() public view {
        assertFalse(rc.cronSubscribed());
        assertFalse(rc.depositWatch());
    }

    function test_fullLoop_standingOrder() public {
        uint256 id = _createOrder(100e6, 60, 3);
        assertTrue(rc.cronSubscribed(), "cron on with first order");

        vm.warp(block.timestamp + 3);
        _cron();
        assertEq(rc.nonce(), 1);
        _deliver();
        assertEq(usd.balanceOf(landlord), 100e6);
        D memory d = _lastDecision();
        assertEq(d.nonce, 1, "vault echoes reactive nonce");
        assertEq(d.kind, vault.KIND_ORDER());
        assertEq(d.executed, 100e6);
        (uint64 nextDue,,) = rc.mirror(id);
        assertEq(nextDue, vault.getOrder(id).nextDue, "mirror follows vault");

        vm.warp(block.timestamp + 30);
        _cron();
        assertEq(sys.callbackCount(), 1, "not due yet -> no callback");

        for (uint256 k = 0; k < 2; ++k) {
            vm.warp(vault.getOrder(id).nextDue + 3);
            _cron();
            _deliver();
        }
        assertEq(usd.balanceOf(landlord), 300e6);
        assertFalse(vault.getOrder(id).active);
        assertFalse(rc.cronSubscribed(), "cron off when nothing is left");
    }

    function test_pendingPreventsDuplicates() public {
        _createOrder(10e6, 60, 0);
        vm.warp(block.timestamp + 3);
        _cron();
        _cron();
        assertEq(sys.callbackCount(), 1);
        vm.warp(block.timestamp + 91);
        _cron();
        assertEq(sys.callbackCount(), 2);
        _deliver();
        assertEq(usd.balanceOf(landlord), 10e6);
        assertEq(_lastDecision().reason, vault.NOT_DUE());
    }

    function test_batchesDueOrders() public {
        _createOrder(1e6, 60, 0);
        _createOrder(2e6, 60, 0);
        _createOrder(3e6, 60, 0);
        vm.warp(block.timestamp + 3);
        _cron();
        assertEq(sys.callbackCount(), 1);
        _deliver();
        assertEq(usd.balanceOf(landlord), 6e6);
        assertEq(decisions.length, 3);
    }

    function test_noCatchUpBurst() public {
        uint256 id = _createOrder(1e6, 60, 0);
        vm.warp(block.timestamp + 1 days);
        _cron();
        _deliver();
        assertEq(usd.balanceOf(landlord), 1e6);
        assertEq(vault.getOrder(id).nextDue, block.timestamp + 60);
    }

    function test_failingOrderAutoCloses() public {
        vm.prank(user);
        usd.approve(address(vault), 1); // tiny allowance: pulls fail, but mandate not revoked
        uint256 id = _createOrder(1e6, 60, 0);
        for (uint256 k = 0; k < 3; ++k) {
            vm.warp(vault.getOrder(id).nextDue + 3);
            _cron();
            _deliver();
        }
        assertFalse(vault.getOrder(id).active);
        assertFalse(rc.cronSubscribed());
    }

    function test_cancel() public {
        uint256 id = _createOrder(1e6, 60, 0);
        _asUser(abi.encodeCall(vault.cancelOrder, (id)), address(vault));
        assertEq(rc.activeOrderIds().length, 0);
        assertFalse(rc.cronSubscribed());
    }

    // ------------------------------------------------------------- auto-save

    function _enableSweep(uint256 minAmount, uint16 bps) internal {
        _asUser(abi.encodeCall(vault.configureSweep, (savings, minAmount, bps, true)), address(vault));
    }

    function test_fullLoop_autoSave() public {
        _enableSweep(100e6, 2_000);
        assertTrue(rc.depositWatch());
        assertTrue(
            sys.isSubscribed(
                address(rc), DEST, address(usd), TRANSFER_TOPIC, IGNORE, uint256(uint160(user)), IGNORE
            )
        );
        _deposit(10e6); // below minimum: filtered on Reactive, no callback
        assertEq(sys.callbackCount(), 0);
        _deposit(1_000e6);
        assertEq(sys.callbackCount(), 1);
        _deliver();
        assertEq(usd.balanceOf(savings), 200e6);
        assertEq(rc.nonce(), 1, "sweep's own Transfer (to savings) never loops");
    }

    function test_reserveOverridesAutoSave() public {
        _enableSweep(100e6, 2_000);
        // balance 5,000 + 1,000 = 6,000; reserve 5,900 -> only 100 of the wanted 200 may move.
        _asUser(abi.encodeCall(vault.configureGuard, (0, 5_900e6)), address(vault));
        _deposit(1_000e6);
        _deliver();
        D memory d = _lastDecision();
        assertEq(d.requested, 200e6);
        assertEq(d.executed, 100e6);
        assertEq(d.reason, vault.RESERVE_CAPPED());
        assertEq(usd.balanceOf(savings), 100e6);

        _asUser(abi.encodeCall(vault.configureGuard, (0, 10_000e6)), address(vault));
        _deposit(500e6);
        _deliver();
        assertEq(_lastDecision().reason, vault.RESERVE_BLOCKED());
        assertEq(usd.balanceOf(savings), 100e6);
    }

    function test_sweepIdempotent() public {
        _enableSweep(1, 1_000);
        bytes memory p = abi.encodeWithSignature(
            "sweep(address,uint256,uint256,bytes32,uint256)", address(0), 7, 100e6, bytes32("tx"), 1
        );
        proxy.deliver(address(vault), p, address(rc));
        proxy.deliver(address(vault), p, address(rc));
        assertEq(usd.balanceOf(savings), 10e6);
    }

    function test_disableSweepUnsubscribes() public {
        _enableSweep(1, 1_000);
        _asUser(abi.encodeCall(vault.configureSweep, (address(0), 0, 0, false)), address(vault));
        assertFalse(rc.depositWatch());
        assertEq(sys.unsubscribeCalls(), 1);
    }

    // ---------------------------------------------------------- safety guard

    function test_mandateRevoked_reactiveCircuitBreaker() public {
        _createOrder(1e6, 60, 0);
        _enableSweep(1, 1_000);
        assertTrue(rc.cronSubscribed() && rc.depositWatch());

        // User revokes the allowance: Reactive sees Approval(user, vault, 0).
        _asUser(abi.encodeCall(usd.approve, (address(vault), 0)), address(usd));
        assertTrue(rc.paused(), "reactive paused itself");
        assertFalse(rc.cronSubscribed(), "cron dropped");
        assertFalse(rc.depositWatch(), "deposit watch dropped");
        assertEq(sys.callbackCount(), 1);
        _deliver(); // tripGuard -> vault paused
        (,,,, bool vPaused, uint8 reason) = vault.guard();
        assertTrue(vPaused);
        assertEq(reason, vault.MANDATE_REVOKED());
        assertEq(_lastDecision().kind, vault.KIND_GUARD());

        // Nothing fires while paused.
        vm.warp(block.timestamp + 600);
        _cron();
        assertEq(sys.callbackCount(), 1);

        // Re-approve and resume -> automation comes back.
        vm.prank(user);
        usd.approve(address(vault), 1_000e6);
        _asUser(abi.encodeCall(vault.resume, ()), address(vault));
        assertFalse(rc.paused());
        assertTrue(rc.cronSubscribed() && rc.depositWatch());
        _cron();
        _deliver();
        assertEq(usd.balanceOf(landlord), 1e6);
    }

    function test_dailyLimitTripsBreaker() public {
        _asUser(abi.encodeCall(vault.configureGuard, (150e6, 0)), address(vault));
        _createOrder(100e6, 60, 0);
        _createOrder(100e6, 60, 0);
        vm.warp(block.timestamp + 3);
        _cron();
        _deliver();
        assertEq(usd.balanceOf(landlord), 100e6, "second payment would exceed 150/day");
        assertEq(_lastDecision().reason, vault.DAILY_LIMIT());
        assertTrue(rc.paused(), "reactive mirrored the vault's guard");
        assertFalse(rc.cronSubscribed());
        assertEq(vault.remainingToday(), 50e6);
    }

    function test_manualPauseAndPausedCallbacksAreNoops() public {
        _createOrder(1e6, 60, 0);
        _asUser(abi.encodeCall(vault.pause, ()), address(vault));
        assertTrue(rc.paused());
        bytes memory p =
            abi.encodeWithSignature("executeDue(address,uint256,uint256[])", address(0), 9, _ids(0));
        proxy.deliver(address(vault), p, address(rc));
        assertEq(usd.balanceOf(landlord), 0);
    }

    function _ids(uint256 a) internal pure returns (uint256[] memory r) {
        r = new uint256[](1);
        r[0] = a;
    }

    function test_setCronTopicResubscribes() public {
        _createOrder(1e6, 60, 0);
        rc.setCronTopic(CRON100);
        assertTrue(sys.isSubscribed(address(rc), block.chainid, LEGACY, CRON100, IGNORE, IGNORE, IGNORE));
        assertFalse(sys.isSubscribed(address(rc), block.chainid, LEGACY, CRON10, IGNORE, IGNORE, IGNORE));
    }

    // -------------------------------------------------------------- security

    function test_reactOnlySystem() public {
        IReactive.LogRecord memory rec;
        vm.expectRevert(abi.encodeWithSelector(AbstractPayer.NotAuthorized.selector, address(this), SYSTEM));
        rc.react(rec);
    }

    function test_vaultRejectsDirectCalls() public {
        vm.expectRevert(
            abi.encodeWithSelector(AbstractPayer.NotAuthorized.selector, address(this), address(proxy))
        );
        vault.executeDue(address(rc), 1, new uint256[](0));
        vm.expectRevert(
            abi.encodeWithSelector(AbstractPayer.NotAuthorized.selector, address(this), address(proxy))
        );
        vault.tripGuard(address(rc), 1, 11);
    }

    function test_vaultRejectsForeignReactiveContract() public {
        bytes memory p = abi.encodeWithSignature("tripGuard(address,uint256,uint8)", address(0), 1, 11);
        vm.expectRevert();
        proxy.deliver(address(vault), p, makeAddr("evilReactive"));
    }

    function test_onlyOwner() public {
        vm.expectRevert(FlowletVault.NotOwner.selector);
        vault.createOrder(landlord, 1, 60, 0, 0);
        vm.expectRevert(FlowletVault.NotOwner.selector);
        vault.resume();
        vm.prank(user);
        vm.expectRevert(FlowletReactive.NotOwner.selector);
        rc.setCronTopic(CRON100);
    }

    function test_rejectsBadRules() public {
        vm.startPrank(user);
        vm.expectRevert(FlowletVault.BadRule.selector);
        vault.createOrder(landlord, 1, 5, 0, 0);
        vm.expectRevert(FlowletVault.BadRule.selector);
        vault.createOrder(user, 1, 60, 0, 0);
        vm.expectRevert(FlowletVault.BadRule.selector);
        vault.configureSweep(user, 1, 1000, true);
        vm.stopPrank();
    }

    function testFuzz_sweepNeverBreaksReserve(uint96 incoming, uint16 bps, uint96 reserve) public {
        bps = uint16(bound(bps, 1, 10_000));
        incoming = uint96(bound(incoming, 1, 2_000e6));
        reserve = uint96(bound(reserve, 0, 8_000e6));
        vm.startPrank(user);
        vault.configureSweep(savings, 1, bps, true);
        vault.configureGuard(0, reserve);
        vm.stopPrank();
        usd.mint(user, incoming);
        uint256 before = usd.balanceOf(user);
        bytes memory p = abi.encodeWithSignature(
            "sweep(address,uint256,uint256,bytes32,uint256)",
            address(0),
            1,
            uint256(incoming),
            bytes32("x"),
            0
        );
        proxy.deliver(address(vault), p, address(rc));
        uint256 saved = usd.balanceOf(savings);
        assertLe(saved, (uint256(incoming) * bps) / 10_000);
        if (saved > 0) assertGe(usd.balanceOf(user), reserve);
        assertEq(before - usd.balanceOf(user), saved);
    }

    function _sweepPayload(uint256 incoming, bytes32 txh, uint256 idx) internal pure returns (bytes memory) {
        return abi.encodeWithSignature(
            "sweep(address,uint256,uint256,bytes32,uint256)", address(0), 1, incoming, txh, idx
        );
    }

    /// Only the paired FlowletReactive contract (via the callback proxy) may drive the vault.
    function testFuzz_foreignCallbackSenderRejected(address evil, uint96 incoming) public {
        vm.assume(evil != address(rc));
        vm.prank(user);
        vault.configureSweep(savings, 1, 10_000, true);
        vm.expectRevert();
        proxy.deliver(address(vault), _sweepPayload(bound(incoming, 1, 1_000e6), "evil", 0), evil);
        vm.expectRevert();
        proxy.deliver(
            address(vault), abi.encodeWithSignature("tripGuard(address,uint256,uint8)", address(0), 1, 11), evil
        );
        assertEq(usd.balanceOf(savings), 0);
        (,,,, bool paused,) = vault.guard();
        assertFalse(paused);
    }

    /// Nobody but the owner can change rules, pause/resume or move native funds.
    function testFuzz_nonOwnerCannotConfigure(address caller) public {
        vm.assume(caller != user);
        vm.startPrank(caller);
        vm.expectRevert(FlowletVault.NotOwner.selector);
        vault.createOrder(caller, 1, 60, 0, 0);
        vm.expectRevert(FlowletVault.NotOwner.selector);
        vault.configureSweep(caller, 1, 10_000, true);
        vm.expectRevert(FlowletVault.NotOwner.selector);
        vault.configureGuard(type(uint256).max, 0);
        vm.expectRevert(FlowletVault.NotOwner.selector);
        vault.pause();
        vm.expectRevert(FlowletVault.NotOwner.selector);
        vault.resume();
        vm.expectRevert(FlowletVault.NotOwner.selector);
        vault.withdrawNative(0);
        vm.stopPrank();
    }

    /// The same origin log can never be auto-saved twice (replay protection).
    function testFuzz_sweepSameLogOnlyOnce(bytes32 txh, uint256 idx, uint96 incoming) public {
        incoming = uint96(bound(incoming, 1, 1_000e6));
        vm.prank(user);
        vault.configureSweep(savings, 1, 5_000, true);
        proxy.deliver(address(vault), _sweepPayload(incoming, txh, idx), address(rc));
        uint256 once = usd.balanceOf(savings);
        proxy.deliver(address(vault), _sweepPayload(incoming, txh, idx), address(rc));
        assertEq(usd.balanceOf(savings), once);
        assertTrue(vault.processedLog(keccak256(abi.encode(txh, idx))));
    }
}
