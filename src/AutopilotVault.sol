// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {IPayable} from "@reactive/src/interfaces/IPayable.sol";
import {AbstractCallback} from "@reactive/src/base/AbstractCallback.sol";

/**
 * @title AutopilotVault
 * @notice Destination-side (callback) contract of Reactive Autopilot.
 *
 * It never takes custody of the user's tokens. The owner approves this vault for a capped
 * allowance and declares two kinds of rules:
 *
 *  1. Standing orders: "pay `amount` of `token` to `payee` every `interval` seconds".
 *  2. An auto-save sweep: "whenever my wallet receives at least `minAmount` of `token`,
 *     move `bps` basis points of it to my `savings` address".
 *
 * Rules only *move* when the paired reactive contract on Reactive Network asks, through the
 * official callback proxy. The vault is still the source of truth: it re-checks every rule
 * on-chain (due time, active flag, duplicate events) so a stale or duplicated callback is a no-op.
 *
 * Every state change is emitted as an event; the reactive contract subscribes to those events
 * and mirrors the schedule, so the user only ever configures rules here, on one chain.
 *
 * Timers use `block.timestamp`, never block counts (Base Sepolia produces 200ms blocks).
 */
contract AutopilotVault is AbstractCallback {
    // ----------------------------------------------------------------- types

    struct Order {
        address token;
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
        address token;
        address savings;
        uint256 minAmount;
        uint16 bps;
        bool active;
    }

    // ------------------------------------------------------------- constants

    uint64 public constant MIN_INTERVAL = 30; // seconds, keeps demo loops short but bounded
    uint64 public constant RETRY_DELAY = 120; // seconds before a failed payment is retried
    uint8 public constant MAX_FAILURES = 3; // consecutive failures before an order auto-closes
    uint256 public constant MAX_BATCH = 16;

    uint8 public constant CLOSED_CANCELLED = 1;
    uint8 public constant CLOSED_COMPLETED = 2;
    uint8 public constant CLOSED_FAILING = 3;

    uint8 public constant IGNORED_NOT_ACTIVE = 1;
    uint8 public constant IGNORED_NOT_DUE = 2;
    uint8 public constant IGNORED_UNKNOWN = 3;

    // ----------------------------------------------------------------- state

    address public immutable owner;
    Order[] internal _orders;
    SweepRule public sweepRule;
    mapping(bytes32 => bool) public processedLog;

    // ---------------------------------------------------------------- events
    // NOTE: the reactive contract decodes these. Keep them in sync with AutopilotReactive.

    event OrderScheduled(
        uint256 indexed id,
        address indexed token,
        address indexed payee,
        uint256 amount,
        uint64 interval,
        uint64 nextDue,
        uint32 maxRuns
    );
    event OrderExecuted(uint256 indexed id, uint32 runs, uint64 nextDue, uint256 amount);
    event OrderPaymentFailed(uint256 indexed id, uint64 retryAt, uint8 failures);
    event OrderClosed(uint256 indexed id, uint8 reason);
    event CallbackIgnored(uint256 indexed id, uint8 reason);
    event SweepConfigured(
        address indexed token, address indexed savings, uint256 minAmount, uint16 bps, bool active
    );
    event Swept(
        address indexed token,
        bytes32 indexed originTxHash,
        uint256 originLogIndex,
        uint256 incoming,
        uint256 saved
    );
    event SweepFailed(address indexed token, bytes32 indexed originTxHash, uint256 originLogIndex);

    error NotOwner();
    error BadRule();
    error UnknownOrder();
    error BatchTooLarge();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    /// @param callbackProxy_ Reactive callback proxy on this chain (Base Sepolia: 0x476F44b1...).
    /// @param reactive_ The AutopilotReactive contract on Reactive Network allowed to drive this vault.
    constructor(IPayable callbackProxy_, address reactive_)
        payable
        AbstractCallback(callbackProxy_, reactive_)
    {
        owner = msg.sender;
    }

    // ------------------------------------------------------------ owner API

    function createOrder(
        address token,
        address payee,
        uint128 amount,
        uint64 interval,
        uint64 startAt,
        uint32 maxRuns
    ) external onlyOwner returns (uint256 id) {
        if (
            token.code.length == 0 || payee == address(0) || payee == owner || amount == 0
                || interval < MIN_INTERVAL
        ) {
            revert BadRule();
        }
        uint64 due = startAt > block.timestamp ? startAt : uint64(block.timestamp);
        id = _orders.length;
        _orders.push(
            Order({
                token: token,
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
        emit OrderScheduled(id, token, payee, amount, interval, due, maxRuns);
    }

    function cancelOrder(uint256 id) external onlyOwner {
        Order storage o = _order(id);
        if (!o.active) revert BadRule();
        o.active = false;
        emit OrderClosed(id, CLOSED_CANCELLED);
    }

    function configureSweep(address token, address savings, uint256 minAmount, uint16 bps, bool active)
        external
        onlyOwner
    {
        if (active) {
            if (
                token.code.length == 0 || savings == address(0) || savings == owner || bps == 0
                    || bps > 10_000
            ) {
                revert BadRule();
            }
        }
        sweepRule =
            SweepRule({token: token, savings: savings, minAmount: minAmount, bps: bps, active: active});
        emit SweepConfigured(token, savings, minAmount, bps, active);
    }

    /// @notice Withdraw native gas budget that is no longer needed.
    function withdrawNative(uint256 amount) external onlyOwner {
        _pay(payable(owner), amount);
    }

    /// @notice Settle any outstanding debt to the callback proxy from this contract's balance.
    function coverDebt() external {
        _coverDebt();
    }

    // -------------------------------------------------------- callback API

    /// @notice Called by Reactive Network (through the callback proxy) when orders look due.
    /// @param reactive_ Injected by the network: the reactive contract that requested the callback.
    function executeDue(address reactive_, uint256[] calldata ids)
        external
        onlyServiceProvider
        onlyCallbackSender(reactive_)
    {
        if (ids.length > MAX_BATCH) revert BatchTooLarge();
        for (uint256 i = 0; i < ids.length; ++i) {
            _execute(ids[i]);
        }
    }

    /// @notice Called by Reactive Network when the owner's wallet received `incoming` of `token`.
    function sweep(
        address reactive_,
        address token,
        uint256 incoming,
        bytes32 originTxHash,
        uint256 originLogIndex
    ) external onlyServiceProvider onlyCallbackSender(reactive_) {
        SweepRule memory r = sweepRule;
        bytes32 key = keccak256(abi.encode(token, originTxHash, originLogIndex));
        if (!r.active || token != r.token || incoming < r.minAmount || processedLog[key]) {
            emit CallbackIgnored(type(uint256).max, IGNORED_NOT_ACTIVE);
            return;
        }
        processedLog[key] = true;
        uint256 saved = (incoming * r.bps) / 10_000;
        if (saved > 0 && _pull(token, r.savings, saved)) {
            emit Swept(token, originTxHash, originLogIndex, incoming, saved);
        } else {
            emit SweepFailed(token, originTxHash, originLogIndex);
        }
    }

    // ---------------------------------------------------------------- views

    function orderCount() external view returns (uint256) {
        return _orders.length;
    }

    function getOrder(uint256 id) external view returns (Order memory) {
        return _order(id);
    }

    // ------------------------------------------------------------- internals

    function _execute(uint256 id) internal {
        if (id >= _orders.length) {
            emit CallbackIgnored(id, IGNORED_UNKNOWN);
            return;
        }
        Order storage o = _orders[id];
        if (!o.active) {
            emit CallbackIgnored(id, IGNORED_NOT_ACTIVE);
            return;
        }
        if (block.timestamp < o.nextDue) {
            emit CallbackIgnored(id, IGNORED_NOT_DUE);
            return;
        }

        if (_pull(o.token, o.payee, o.amount)) {
            o.runs += 1;
            o.failures = 0;
            uint64 next = o.nextDue + o.interval;
            // Never "catch up" with a burst of payments after downtime.
            if (next <= block.timestamp) next = uint64(block.timestamp) + o.interval;
            o.nextDue = next;
            emit OrderExecuted(id, o.runs, next, o.amount);
            if (o.maxRuns != 0 && o.runs >= o.maxRuns) {
                o.active = false;
                emit OrderClosed(id, CLOSED_COMPLETED);
            }
        } else {
            o.failures += 1;
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

    /// @dev transferFrom(owner -> to) that never reverts; tolerates tokens without a return value.
    function _pull(address token, address to, uint256 amount) internal returns (bool) {
        (bool ok, bytes memory ret) = token.call(abi.encodeWithSelector(0x23b872dd, owner, to, amount)); // transferFrom
        return ok && (ret.length == 0 || (ret.length == 32 && abi.decode(ret, (bool))));
    }

    function _order(uint256 id) internal view returns (Order storage) {
        if (id >= _orders.length) revert UnknownOrder();
        return _orders[id];
    }
}
