// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {ISystemContract} from "@reactive/src/interfaces/ISystemContract.sol";
import {IReactive} from "@reactive/src/interfaces/IReactive.sol";
import {AbstractReactive} from "@reactive/src/base/AbstractReactive.sol";

/**
 * @title FlowletReactive
 * @notice The brain of Flowlet, deployed on Reactive Network (Lasna testnet). Holds no user funds.
 *
 *  - Mirrors every rule by subscribing to the vault's own events: users configure rules in one place.
 *  - Subscribes to CRON only while a standing order is active and the guard is not tripped.
 *  - Subscribes at runtime to `Transfer(to = wallet)` only while auto-save is on.
 *  - Safety Guard (circuit breaker): watches `Approval(wallet -> vault)`. If the mandate is revoked it
 *    pauses itself immediately, drops its CRON and deposit subscriptions, and tells the vault to pause.
 *    It also mirrors pauses raised by the vault (daily limit, manual stop) and resumes when the owner does.
 *  - Every callback carries a `nonce` that the vault echoes in `Decision`, giving an exact execution trace:
 *    origin event -> FlowRequested(nonce) on Lasna -> Decision(nonce) on the destination chain.
 */
contract FlowletReactive is AbstractReactive {
    // ------------------------------------------------------------- constants

    address internal constant LEGACY_SYSTEM_ADDR = 0x0000000000000000000000000000000000fffFfF;

    uint256 internal constant TRANSFER_TOPIC = uint256(keccak256("Transfer(address,address,uint256)"));
    uint256 internal constant APPROVAL_TOPIC = uint256(keccak256("Approval(address,address,uint256)"));
    uint256 internal constant ORDER_SCHEDULED_TOPIC =
        uint256(keccak256("OrderScheduled(uint256,address,uint256,uint64,uint64,uint32)"));
    uint256 internal constant ORDER_EXECUTED_TOPIC =
        uint256(keccak256("OrderExecuted(uint256,uint32,uint64,uint256)"));
    uint256 internal constant ORDER_FAILED_TOPIC =
        uint256(keccak256("OrderPaymentFailed(uint256,uint64,uint8)"));
    uint256 internal constant ORDER_CLOSED_TOPIC = uint256(keccak256("OrderClosed(uint256,uint8)"));
    uint256 internal constant SWEEP_CONFIGURED_TOPIC =
        uint256(keccak256("SweepConfigured(address,uint256,uint16,bool)"));
    uint256 internal constant GUARD_TRIPPED_TOPIC = uint256(keccak256("GuardTripped(uint8)"));
    uint256 internal constant GUARD_RESET_TOPIC = uint256(keccak256("GuardReset()"));

    uint8 public constant KIND_ORDER = 1;
    uint8 public constant KIND_SWEEP = 2;
    uint8 public constant KIND_GUARD = 3;
    uint8 public constant MANDATE_REVOKED = 11;

    uint256 public constant MAX_ACTIVE_ORDERS = 32;
    uint256 public constant MAX_BATCH = 8;
    uint64 public constant PENDING_TIMEOUT = 90;
    uint64 public constant DUE_GRACE = 2;

    // ----------------------------------------------------------------- state

    struct Mirror {
        uint64 nextDue;
        uint64 pendingSince;
        bool active;
    }

    address public immutable owner;
    uint256 public immutable destinationChainId;

    address public vault;
    address public wallet;
    address public token;
    uint256 public cronTopic;
    uint64 public callbackGasLimit = 1_000_000;

    bool public paused; // Safety Guard state (mirrored from / pushed to the vault)
    bool public sweepActive;
    uint256 public sweepMinAmount;
    bool public cronSubscribed;
    bool public depositWatch;

    mapping(uint256 => Mirror) public mirror;
    uint256[] internal _activeIds;
    mapping(uint256 => uint256) internal _activeIndexPlusOne;

    uint256 public nonce; // last callback request id
    uint256 public ticks;

    // ---------------------------------------------------------------- events

    event VaultSet(address indexed vault, address indexed wallet, address indexed token);
    event OrderMirrored(uint256 indexed id, uint64 nextDue, bool active);
    event SubscriptionChanged(string what, bool on);
    event GuardStateChanged(bool paused, uint8 reason);
    /// @notice One per callback request. `originTxHash` is the destination-chain tx that caused it (0 for CRON).
    event FlowRequested(
        uint256 indexed nonce, uint8 indexed kind, bytes32 indexed originTxHash, uint256 value, uint256[] ids
    );

    error NotOwner();
    error AlreadySet();
    error BadParam();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(uint256 destinationChainId_, uint256 cronTopic_) payable {
        owner = msg.sender;
        destinationChainId = destinationChainId_;
        cronTopic = cronTopic_;
    }

    // ------------------------------------------------------------ owner API

    function setVault(address vault_, address wallet_, address token_) external onlyOwner {
        if (vault != address(0)) revert AlreadySet();
        if (vault_ == address(0) || wallet_ == address(0) || token_ == address(0)) revert BadParam();
        vault = vault_;
        wallet = wallet_;
        token = token_;
        _subscribeVault(ORDER_SCHEDULED_TOPIC);
        _subscribeVault(ORDER_EXECUTED_TOPIC);
        _subscribeVault(ORDER_FAILED_TOPIC);
        _subscribeVault(ORDER_CLOSED_TOPIC);
        _subscribeVault(SWEEP_CONFIGURED_TOPIC);
        _subscribeVault(GUARD_TRIPPED_TOPIC);
        _subscribeVault(GUARD_RESET_TOPIC);
        // Mandate watch: Approval(owner = wallet, spender = vault).
        SYSTEM.subscribe(
            destinationChainId,
            token_,
            APPROVAL_TOPIC,
            uint256(uint160(wallet_)),
            uint256(uint160(vault_)),
            REACTIVE_IGNORE
        );
        emit VaultSet(vault_, wallet_, token_);
    }

    function setCronTopic(uint256 topic_) external onlyOwner {
        if (topic_ == 0) revert BadParam();
        bool was = cronSubscribed;
        if (was) _setCron(false);
        cronTopic = topic_;
        if (was) _setCron(true);
    }

    function setCallbackGasLimit(uint64 gasLimit_) external onlyOwner {
        if (gasLimit_ < 100_000) revert BadParam();
        callbackGasLimit = gasLimit_;
    }

    function coverDebt() external {
        _coverDebt();
    }

    function withdraw(uint256 amount_) external onlyOwner {
        _pay(payable(owner), amount_);
    }

    // ------------------------------------------------------------- reactive

    /// @inheritdoc IReactive
    function react(LogRecord calldata log_) external onlySystem {
        if (log_.contractAddress == LEGACY_SYSTEM_ADDR && log_.chainId == block.chainid) {
            if (log_.topic0 == cronTopic) _onCron();
            return;
        }
        if (log_.chainId != destinationChainId) return;

        if (log_.contractAddress == vault) {
            _onVaultEvent(log_);
        } else if (log_.contractAddress == token && log_.opCode == 3) {
            if (log_.topic0 == TRANSFER_TOPIC && log_.topic2 == uint256(uint160(wallet))) {
                _onDeposit(log_);
            } else if (
                log_.topic0 == APPROVAL_TOPIC && log_.topic1 == uint256(uint160(wallet))
                    && log_.topic2 == uint256(uint160(vault))
            ) {
                _onApproval(log_);
            }
        }
    }

    // ---------------------------------------------------------------- views

    function activeOrderIds() external view returns (uint256[] memory) {
        return _activeIds;
    }

    function dueOrderIds(uint256 at_) public view returns (uint256[] memory ids, uint256 n) {
        ids = new uint256[](MAX_BATCH);
        for (uint256 i = 0; i < _activeIds.length && n < MAX_BATCH; ++i) {
            Mirror memory m = mirror[_activeIds[i]];
            if (m.nextDue + DUE_GRACE > at_) continue;
            if (m.pendingSince != 0 && m.pendingSince + PENDING_TIMEOUT > at_) continue;
            ids[n++] = _activeIds[i];
        }
    }

    // ------------------------------------------------------------- handlers

    function _onCron() internal {
        ticks += 1;
        if (paused) return;
        (uint256[] memory buf, uint256 n) = dueOrderIds(block.timestamp);
        if (n == 0) return;
        uint256[] memory ids = new uint256[](n);
        for (uint256 i = 0; i < n; ++i) {
            ids[i] = buf[i];
            mirror[buf[i]].pendingSince = uint64(block.timestamp);
        }
        uint256 id_ = ++nonce;
        _callback(abi.encodeWithSignature("executeDue(address,uint256,uint256[])", address(0), id_, ids));
        emit FlowRequested(id_, KIND_ORDER, bytes32(0), block.number, ids);
    }

    function _onDeposit(LogRecord calldata log_) internal {
        if (paused || !sweepActive) return;
        uint256 amount = abi.decode(log_.data, (uint256));
        if (amount == 0 || amount < sweepMinAmount) return;
        uint256 id_ = ++nonce;
        _callback(
            abi.encodeWithSignature(
                "sweep(address,uint256,uint256,bytes32,uint256)",
                address(0),
                id_,
                amount,
                bytes32(log_.txHash),
                log_.logIndex
            )
        );
        emit FlowRequested(id_, KIND_SWEEP, bytes32(log_.txHash), amount, new uint256[](0));
    }

    /// @dev Circuit breaker: a revoked mandate stops everything on the reactive side first, then the vault.
    function _onApproval(LogRecord calldata log_) internal {
        uint256 value = abi.decode(log_.data, (uint256));
        if (value != 0 || paused) return;
        _setPaused(true, MANDATE_REVOKED);
        uint256 id_ = ++nonce;
        _callback(
            abi.encodeWithSignature("tripGuard(address,uint256,uint8)", address(0), id_, MANDATE_REVOKED)
        );
        emit FlowRequested(id_, KIND_GUARD, bytes32(log_.txHash), 0, new uint256[](0));
    }

    function _onVaultEvent(LogRecord calldata log_) internal {
        uint256 t = log_.topic0;
        if (t == ORDER_SCHEDULED_TOPIC) {
            (,, uint64 nextDue,) = abi.decode(log_.data, (uint256, uint64, uint64, uint32));
            _upsert(log_.topic1, nextDue);
        } else if (t == ORDER_EXECUTED_TOPIC) {
            (, uint64 nextDue,) = abi.decode(log_.data, (uint32, uint64, uint256));
            _upsert(log_.topic1, nextDue);
        } else if (t == ORDER_FAILED_TOPIC) {
            (uint64 retryAt,) = abi.decode(log_.data, (uint64, uint8));
            if (retryAt != 0) _upsert(log_.topic1, retryAt);
        } else if (t == ORDER_CLOSED_TOPIC) {
            _remove(log_.topic1);
        } else if (t == SWEEP_CONFIGURED_TOPIC) {
            (uint256 minAmount,, bool active) = abi.decode(log_.data, (uint256, uint16, bool));
            sweepActive = active;
            sweepMinAmount = minAmount;
            _sync();
        } else if (t == GUARD_TRIPPED_TOPIC) {
            _setPaused(true, uint8(log_.topic1));
        } else if (t == GUARD_RESET_TOPIC) {
            // Pending flags are stale after a pause; let due orders be requested again right away.
            for (uint256 i = 0; i < _activeIds.length; ++i) {
                mirror[_activeIds[i]].pendingSince = 0;
            }
            _setPaused(false, 0);
        }
    }

    // ------------------------------------------------------------- internals

    function _setPaused(bool p, uint8 reason) internal {
        if (paused == p) return;
        paused = p;
        emit GuardStateChanged(p, reason);
        _sync();
    }

    /// @dev Reconcile subscriptions with state: pay for CRON / deposit events only while they can matter.
    function _sync() internal {
        bool wantCron = !paused && _activeIds.length > 0;
        if (wantCron != cronSubscribed) _setCron(wantCron);
        bool wantWatch = !paused && sweepActive;
        if (wantWatch != depositWatch) {
            if (wantWatch) {
                SYSTEM.subscribe(
                    destinationChainId,
                    token,
                    TRANSFER_TOPIC,
                    REACTIVE_IGNORE,
                    uint256(uint160(wallet)),
                    REACTIVE_IGNORE
                );
            } else {
                SYSTEM.unsubscribe(
                    destinationChainId,
                    token,
                    TRANSFER_TOPIC,
                    REACTIVE_IGNORE,
                    uint256(uint160(wallet)),
                    REACTIVE_IGNORE
                );
            }
            depositWatch = wantWatch;
            emit SubscriptionChanged("deposits", wantWatch);
        }
    }

    function _upsert(uint256 id, uint64 nextDue) internal {
        Mirror storage m = mirror[id];
        m.nextDue = nextDue;
        m.pendingSince = 0;
        if (!m.active) {
            if (_activeIds.length >= MAX_ACTIVE_ORDERS) return;
            m.active = true;
            _activeIds.push(id);
            _activeIndexPlusOne[id] = _activeIds.length;
        }
        emit OrderMirrored(id, nextDue, true);
        _sync();
    }

    function _remove(uint256 id) internal {
        Mirror storage m = mirror[id];
        if (!m.active) return;
        m.active = false;
        m.pendingSince = 0;
        uint256 idx = _activeIndexPlusOne[id] - 1;
        uint256 last = _activeIds[_activeIds.length - 1];
        _activeIds[idx] = last;
        _activeIndexPlusOne[last] = idx + 1;
        _activeIds.pop();
        delete _activeIndexPlusOne[id];
        emit OrderMirrored(id, m.nextDue, false);
        _sync();
    }

    function _setCron(bool on) internal {
        if (on) {
            SYSTEM.subscribe(
                block.chainid,
                LEGACY_SYSTEM_ADDR,
                cronTopic,
                REACTIVE_IGNORE,
                REACTIVE_IGNORE,
                REACTIVE_IGNORE
            );
        } else {
            SYSTEM.unsubscribe(
                block.chainid,
                LEGACY_SYSTEM_ADDR,
                cronTopic,
                REACTIVE_IGNORE,
                REACTIVE_IGNORE,
                REACTIVE_IGNORE
            );
        }
        cronSubscribed = on;
        emit SubscriptionChanged("cron", on);
    }

    function _subscribeVault(uint256 topic0) internal {
        SYSTEM.subscribe(destinationChainId, vault, topic0, REACTIVE_IGNORE, REACTIVE_IGNORE, REACTIVE_IGNORE);
    }

    function _callback(bytes memory payload) internal {
        SYSTEM.requestCallbackV_1_0(
            ISystemContract.CallbackConfiguration_V_1_0({
                chainId: destinationChainId, recipient: vault, gasLimit: callbackGasLimit, payload: payload
            })
        );
    }
}
