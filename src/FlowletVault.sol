// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {IPayable} from "@reactive/src/interfaces/IPayable.sol";
import {AbstractCallback} from "@reactive/src/base/AbstractCallback.sol";

interface IERC20Balance {
    function balanceOf(address) external view returns (uint256);
}

/**
 * @title FlowletVault
 * @notice Destination-side (callback) contract of Flowlet: "Money moves on your rules."
 *
 * Non-custodial: the owner approves this vault for a capped allowance of one stablecoin and declares
 *  1. Standing orders  - pay `amount` to `payee` every `interval` seconds (optionally N times).
 *  2. Auto-save        - when the wallet receives >= `minAmount`, move `bps` of it to `savings`.
 *  3. Safety Guard     - a daily spending limit for standing orders, and an emergency reserve that
 *                        auto-save never dips below (the reserve overrides the auto-save percentage).
 *
 * Rules only move funds when FlowletReactive (on Reactive Network) calls back through the official
 * callback proxy. Every evaluation emits a `Decision` event tagged with the reactive request `nonce`,
 * so each action can be traced back to the reactive transaction (and origin event) that caused it.
 *
 * Timers use `block.timestamp` only (Base Sepolia produces 200ms blocks).
 */
contract FlowletVault is AbstractCallback {
    // ----------------------------------------------------------------- types

    struct Order {
        address payee;
        uint128 amount;
        uint64 interval; // seconds
        uint64 nextDue; // unix timestamp
        uint32 runs;
        uint32 maxRuns; // 0 = unlimited
        uint8 failures; // consecutive failed pulls
        bool active;
    }

    struct SweepRule {
        address savings;
        uint256 minAmount;
        uint16 bps;
        bool active;
    }

    struct Guard {
        uint256 dailyLimit; // max paid out by standing orders per 24h window, 0 = no limit
        uint256 reserveFloor; // auto-save never takes the wallet balance below this
        uint256 spentInWindow;
        uint64 windowStart;
        bool paused;
        uint8 pauseReason;
    }

    // ------------------------------------------------------------- constants

    uint64 public constant MIN_INTERVAL = 30;
    uint64 public constant RETRY_DELAY = 120;
    uint8 public constant MAX_FAILURES = 3;
    uint256 public constant MAX_BATCH = 16;
    uint64 public constant WINDOW = 1 days;

    // Decision kinds
    uint8 public constant KIND_ORDER = 1;
    uint8 public constant KIND_SWEEP = 2;
    uint8 public constant KIND_GUARD = 3;

    // Decision / pause reasons
    uint8 public constant OK = 0;
    uint8 public constant RESERVE_CAPPED = 1; // auto-save reduced to protect the emergency reserve
    uint8 public constant NOT_DUE = 2;
    uint8 public constant NOT_ACTIVE = 3;
    uint8 public constant PAUSED = 4;
    uint8 public constant DAILY_LIMIT = 5;
    uint8 public constant PULL_FAILED = 6;
    uint8 public constant DUPLICATE = 7;
    uint8 public constant BELOW_MIN = 8;
    uint8 public constant UNKNOWN_ORDER = 9;
    uint8 public constant RESERVE_BLOCKED = 10; // nothing saved: wallet is at/below the reserve
    uint8 public constant MANDATE_REVOKED = 11;
    uint8 public constant MANUAL = 12;

    // OrderClosed reasons
    uint8 public constant CLOSED_CANCELLED = 1;
    uint8 public constant CLOSED_COMPLETED = 2;
    uint8 public constant CLOSED_FAILING = 3;

    // ----------------------------------------------------------------- state

    address public immutable owner;
    address public immutable token;
    Order[] internal _orders;
    SweepRule public sweepRule;
    Guard public guard;
    mapping(bytes32 => bool) public processedLog;

    // ---------------------------------------------------------------- events
    // FlowletReactive decodes the first seven. Keep them in sync.

    event OrderScheduled(
        uint256 indexed id,
        address indexed payee,
        uint256 amount,
        uint64 interval,
        uint64 nextDue,
        uint32 maxRuns
    );
    event OrderExecuted(uint256 indexed id, uint32 runs, uint64 nextDue, uint256 amount);
    event OrderPaymentFailed(uint256 indexed id, uint64 retryAt, uint8 failures);
    event OrderClosed(uint256 indexed id, uint8 reason);
    event SweepConfigured(address indexed savings, uint256 minAmount, uint16 bps, bool active);
    event GuardTripped(uint8 indexed reason);
    event GuardReset();
    event GuardConfigured(uint256 dailyLimit, uint256 reserveFloor);
    /// @notice One per rule evaluation. `nonce` matches FlowRequested(nonce) on Reactive Network.
    event Decision(
        uint256 indexed nonce,
        uint8 indexed kind,
        uint256 indexed ruleId,
        uint256 requested,
        uint256 executed,
        uint8 reason,
        address to
    );

    error NotOwner();
    error BadRule();
    error UnknownOrder();
    error BatchTooLarge();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    /// @param callbackProxy_ Reactive callback proxy on this chain (Base Sepolia: 0x476F44b1...).
    /// @param reactive_ The FlowletReactive contract allowed to drive this vault.
    /// @param token_ The stablecoin this vault automates.
    constructor(IPayable callbackProxy_, address reactive_, address token_)
        payable
        AbstractCallback(callbackProxy_, reactive_)
    {
        if (token_.code.length == 0) revert BadRule();
        owner = msg.sender;
        token = token_;
    }

    // ------------------------------------------------------------ owner API

    function createOrder(address payee, uint128 amount, uint64 interval, uint64 startAt, uint32 maxRuns)
        external
        onlyOwner
        returns (uint256 id)
    {
        if (payee == address(0) || payee == owner || amount == 0 || interval < MIN_INTERVAL) {
            revert BadRule();
        }
        uint64 due = startAt > block.timestamp ? startAt : uint64(block.timestamp);
        id = _orders.length;
        _orders.push(
            Order({
                payee: payee,
                amount: amount,
                interval: interval,
                nextDue: due,
                runs: 0,
                maxRuns: maxRuns,
                failures: 0,
                active: true
            })
        );
        emit OrderScheduled(id, payee, amount, interval, due, maxRuns);
    }

    function cancelOrder(uint256 id) external onlyOwner {
        Order storage o = _order(id);
        if (!o.active) revert BadRule();
        o.active = false;
        emit OrderClosed(id, CLOSED_CANCELLED);
    }

    function configureSweep(address savings, uint256 minAmount, uint16 bps, bool active) external onlyOwner {
        if (active && (savings == address(0) || savings == owner || bps == 0 || bps > 10_000)) {
            revert BadRule();
        }
        sweepRule = SweepRule({savings: savings, minAmount: minAmount, bps: bps, active: active});
        emit SweepConfigured(savings, minAmount, bps, active);
    }

    function configureGuard(uint256 dailyLimit, uint256 reserveFloor) external onlyOwner {
        guard.dailyLimit = dailyLimit;
        guard.reserveFloor = reserveFloor;
        emit GuardConfigured(dailyLimit, reserveFloor);
    }

    /// @notice Emergency stop. FlowletReactive mirrors it and drops its CRON and deposit subscriptions.
    function pause() external onlyOwner {
        _trip(MANUAL);
    }

    /// @notice Resume after the Safety Guard tripped. Also resets the daily window.
    function resume() external onlyOwner {
        guard.paused = false;
        guard.pauseReason = 0;
        guard.spentInWindow = 0;
        guard.windowStart = uint64(block.timestamp);
        emit GuardReset();
    }

    function withdrawNative(uint256 amount) external onlyOwner {
        _pay(payable(owner), amount);
    }

    function coverDebt() external {
        _coverDebt();
    }

    // -------------------------------------------------------- callback API

    /// @notice CRON-driven: FlowletReactive found these orders due.
    function executeDue(address reactive_, uint256 nonce, uint256[] calldata ids)
        external
        onlyServiceProvider
        onlyCallbackSender(reactive_)
    {
        if (ids.length > MAX_BATCH) revert BatchTooLarge();
        for (uint256 i = 0; i < ids.length; ++i) {
            _execute(nonce, ids[i]);
        }
    }

    /// @notice Event-driven: the owner's wallet received `incoming` (origin log identified for idempotency).
    function sweep(
        address reactive_,
        uint256 nonce,
        uint256 incoming,
        bytes32 originTxHash,
        uint256 originLogIndex
    ) external onlyServiceProvider onlyCallbackSender(reactive_) {
        SweepRule memory r = sweepRule;
        bytes32 key = keccak256(abi.encode(originTxHash, originLogIndex));
        uint256 wanted = (incoming * r.bps) / 10_000;
        uint8 reason;
        if (guard.paused) reason = PAUSED;
        else if (!r.active) reason = NOT_ACTIVE;
        else if (incoming < r.minAmount) reason = BELOW_MIN;
        else if (processedLog[key]) reason = DUPLICATE;
        if (reason != OK) {
            emit Decision(nonce, KIND_SWEEP, 0, wanted, 0, reason, r.savings);
            return;
        }
        processedLog[key] = true;

        // Multi-rule interaction: the emergency reserve overrides the auto-save percentage.
        uint256 balance = IERC20Balance(token).balanceOf(owner);
        uint256 headroom = balance > guard.reserveFloor ? balance - guard.reserveFloor : 0;
        uint256 amount = wanted;
        if (headroom < wanted) {
            amount = headroom;
            reason = headroom == 0 ? RESERVE_BLOCKED : RESERVE_CAPPED;
        }
        if (amount > 0 && !_pull(r.savings, amount)) {
            emit Decision(nonce, KIND_SWEEP, 0, wanted, 0, PULL_FAILED, r.savings);
            return;
        }
        emit Decision(nonce, KIND_SWEEP, 0, wanted, amount, reason, r.savings);
    }

    /// @notice Reactive circuit breaker: FlowletReactive saw the mandate (allowance) revoked.
    function tripGuard(address reactive_, uint256 nonce, uint8 reason)
        external
        onlyServiceProvider
        onlyCallbackSender(reactive_)
    {
        _trip(reason);
        emit Decision(nonce, KIND_GUARD, 0, 0, 0, reason, address(0));
    }

    // ---------------------------------------------------------------- views

    function orderCount() external view returns (uint256) {
        return _orders.length;
    }

    function getOrder(uint256 id) external view returns (Order memory) {
        return _order(id);
    }

    /// @notice Amount standing orders may still pay out in the current 24h window (max uint if unlimited).
    function remainingToday() external view returns (uint256) {
        if (guard.dailyLimit == 0) return type(uint256).max;
        uint256 spent = block.timestamp >= guard.windowStart + WINDOW ? 0 : guard.spentInWindow;
        return guard.dailyLimit > spent ? guard.dailyLimit - spent : 0;
    }

    // ------------------------------------------------------------- internals

    function _execute(uint256 nonce, uint256 id) internal {
        if (id >= _orders.length) {
            emit Decision(nonce, KIND_ORDER, id, 0, 0, UNKNOWN_ORDER, address(0));
            return;
        }
        Order storage o = _orders[id];
        uint8 reason;
        if (guard.paused) reason = PAUSED;
        else if (!o.active) reason = NOT_ACTIVE;
        else if (block.timestamp < o.nextDue) reason = NOT_DUE;
        if (reason != OK) {
            emit Decision(nonce, KIND_ORDER, id, o.amount, 0, reason, o.payee);
            return;
        }

        // Safety Guard: daily limit trips the circuit breaker instead of overspending.
        if (guard.dailyLimit != 0) {
            if (block.timestamp >= guard.windowStart + WINDOW) {
                guard.windowStart = uint64(block.timestamp);
                guard.spentInWindow = 0;
            }
            if (guard.spentInWindow + o.amount > guard.dailyLimit) {
                emit Decision(nonce, KIND_ORDER, id, o.amount, 0, DAILY_LIMIT, o.payee);
                _trip(DAILY_LIMIT);
                return;
            }
        }

        if (_pull(o.payee, o.amount)) {
            guard.spentInWindow += o.amount;
            o.runs += 1;
            o.failures = 0;
            uint64 next = o.nextDue + o.interval;
            if (next <= block.timestamp) next = uint64(block.timestamp) + o.interval; // no catch-up bursts
            o.nextDue = next;
            emit Decision(nonce, KIND_ORDER, id, o.amount, o.amount, OK, o.payee);
            emit OrderExecuted(id, o.runs, next, o.amount);
            if (o.maxRuns != 0 && o.runs >= o.maxRuns) {
                o.active = false;
                emit OrderClosed(id, CLOSED_COMPLETED);
            }
        } else {
            o.failures += 1;
            emit Decision(nonce, KIND_ORDER, id, o.amount, 0, PULL_FAILED, o.payee);
            if (o.failures >= MAX_FAILURES) {
                o.active = false;
                emit OrderPaymentFailed(id, 0, o.failures);
                emit OrderClosed(id, CLOSED_FAILING);
            } else {
                uint64 retryAt =
                    uint64(block.timestamp) + (o.interval < RETRY_DELAY ? o.interval : RETRY_DELAY);
                o.nextDue = retryAt;
                emit OrderPaymentFailed(id, retryAt, o.failures);
            }
        }
    }

    function _trip(uint8 reason) internal {
        if (guard.paused) return;
        guard.paused = true;
        guard.pauseReason = reason;
        emit GuardTripped(reason);
    }

    /// @dev transferFrom(owner -> to) that never reverts; tolerates tokens without a return value.
    function _pull(address to, uint256 amount) internal returns (bool) {
        (bool ok, bytes memory ret) = token.call(abi.encodeWithSelector(0x23b872dd, owner, to, amount));
        return ok && (ret.length == 0 || (ret.length == 32 && abi.decode(ret, (bool))));
    }

    function _order(uint256 id) internal view returns (Order storage) {
        if (id >= _orders.length) revert UnknownOrder();
        return _orders[id];
    }
}
