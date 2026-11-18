// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {ISystemContract} from "@reactive/src/interfaces/ISystemContract.sol";
import {IReactive} from "@reactive/src/interfaces/IReactive.sol";
import {AbstractReactive} from "@reactive/src/base/AbstractReactive.sol";

/**
 * @title AutopilotReactive
 * @notice The brain of Reactive Autopilot, deployed on Reactive Network (Lasna testnet).
 *
 * It holds no user funds and needs no manual configuration beyond `setVault()`:
 *
 *  - It subscribes to the vault's own events on the destination chain and mirrors every standing
 *    order (id -> next due time). The user configures rules in one place, the vault.
 *  - It subscribes to Reactive's CRON only while at least one order is active, and drops the
 *    subscription when the last one closes, so an idle autopilot costs nothing.
 *  - When the user configures an auto-save sweep, it subscribes *at runtime* to the ERC-20
 *    `Transfer` events of that token whose `to` is the user's wallet. A qualifying deposit
 *    triggers a `sweep()` callback a few seconds later.
 *  - On each CRON tick it batches every due order into a single `executeDue()` callback.
 */
contract AutopilotReactive is AbstractReactive {
    // ------------------------------------------------------------- constants

    address internal constant LEGACY_SYSTEM_ADDR = 0x0000000000000000000000000000000000fffFfF;

    uint256 internal constant TRANSFER_TOPIC = uint256(keccak256("Transfer(address,address,uint256)"));
    uint256 internal constant ORDER_SCHEDULED_TOPIC =
        uint256(keccak256("OrderScheduled(uint256,address,address,uint256,uint64,uint64,uint32)"));
    uint256 internal constant ORDER_EXECUTED_TOPIC =
        uint256(keccak256("OrderExecuted(uint256,uint32,uint64,uint256)"));
    uint256 internal constant ORDER_FAILED_TOPIC =
        uint256(keccak256("OrderPaymentFailed(uint256,uint64,uint8)"));
    uint256 internal constant ORDER_CLOSED_TOPIC = uint256(keccak256("OrderClosed(uint256,uint8)"));
    uint256 internal constant SWEEP_CONFIGURED_TOPIC =
        uint256(keccak256("SweepConfigured(address,address,uint256,uint16,bool)"));

    uint256 public constant MAX_ACTIVE_ORDERS = 32;
    uint256 public constant MAX_BATCH = 8;
    /// @dev Seconds to wait for the vault to confirm a requested execution before asking again.
    uint64 public constant PENDING_TIMEOUT = 90;
    /// @dev Small grace period so clock skew between Reactive and the destination never yields NOT_DUE.
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
    address public wallet; // the vault owner's wallet, watched for incoming deposits
    uint256 public cronTopic; // which CRON interval to use while active
    bool public cronSubscribed;
    uint64 public callbackGasLimit = 1_000_000;

    mapping(uint256 => Mirror) public mirror;
    uint256[] internal _activeIds;
    mapping(uint256 => uint256) internal _activeIndexPlusOne;

    address public sweepToken;
    uint256 public sweepMinAmount;
    bool public sweepSubscribed;

    // Observability counters (visible on lasna.reactscan.net).
    uint256 public ticks;
    uint256 public executionRequests;
    uint256 public sweepRequests;

    // ---------------------------------------------------------------- events

    event VaultSet(address indexed vault, address indexed wallet);
    event OrderMirrored(uint256 indexed id, uint64 nextDue, bool active);
    event CronToggled(uint256 indexed topic, bool subscribed);
    event ExecutionRequested(uint256[] ids, uint256 indexed cronBlock);
    event SweepWatchChanged(address indexed token, uint256 minAmount, bool watching);
    event SweepRequested(bytes32 indexed originTxHash, uint256 originLogIndex, uint256 amount);

    error NotOwner();
    error AlreadySet();
    error BadParam();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    /// @param destinationChainId_ Chain where the vault lives (Base Sepolia 84532, Unichain Sepolia 1301, ...).
    /// @param cronTopic_ CRON topic used while orders are active (e.g. Cron10 for demos, Cron100 for daily use).
    constructor(uint256 destinationChainId_, uint256 cronTopic_) payable {
        owner = msg.sender;
        destinationChainId = destinationChainId_;
        cronTopic = cronTopic_;
    }

    // ------------------------------------------------------------ owner API

    /// @notice Wire the reactive contract to its vault. Can only be done once (vault trusts this contract immutably).
    function setVault(address vault_, address wallet_) external onlyOwner {
        if (vault != address(0)) revert AlreadySet();
        if (vault_ == address(0) || wallet_ == address(0)) revert BadParam();
        vault = vault_;
        wallet = wallet_;
        _subscribeVault(ORDER_SCHEDULED_TOPIC);
        _subscribeVault(ORDER_EXECUTED_TOPIC);
        _subscribeVault(ORDER_FAILED_TOPIC);
        _subscribeVault(ORDER_CLOSED_TOPIC);
        _subscribeVault(SWEEP_CONFIGURED_TOPIC);
        emit VaultSet(vault_, wallet_);
    }

    /// @notice Switch CRON cadence, e.g. Cron10 (~10s) for a demo and Cron100 (~100s) afterwards.
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

    /// @notice Settle outstanding debt with the system contract from this contract's balance.
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
        } else if (
            sweepSubscribed && log_.contractAddress == sweepToken && log_.topic0 == TRANSFER_TOPIC
                && log_.opCode == 3 && log_.topic2 == uint256(uint160(wallet))
        ) {
            _onIncomingTransfer(log_);
        }
    }

    // ---------------------------------------------------------------- views

    function activeOrderIds() external view returns (uint256[] memory) {
        return _activeIds;
    }

    /// @notice Orders the next CRON tick would request (view helper for dashboards and tests).
    function dueOrderIds(uint256 at_) public view returns (uint256[] memory ids, uint256 n) {
        ids = new uint256[](MAX_BATCH);
        for (uint256 i = 0; i < _activeIds.length && n < MAX_BATCH; ++i) {
            Mirror memory m = mirror[_activeIds[i]];
            if (m.nextDue + DUE_GRACE > at_) continue;
            if (m.pendingSince != 0 && m.pendingSince + PENDING_TIMEOUT > at_) continue;
            ids[n++] = _activeIds[i];
        }
    }

    // ------------------------------------------------------------- internals

    function _onCron() internal {
        ticks += 1;
        (uint256[] memory buf, uint256 n) = dueOrderIds(block.timestamp);
        if (n == 0) return;
        uint256[] memory ids = new uint256[](n);
        for (uint256 i = 0; i < n; ++i) {
            ids[i] = buf[i];
            mirror[buf[i]].pendingSince = uint64(block.timestamp);
        }
        executionRequests += 1;
        _callback(abi.encodeWithSignature("executeDue(address,uint256[])", address(0), ids));
        emit ExecutionRequested(ids, block.number);
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
            _setSweepWatch(address(uint160(log_.topic1)), minAmount, active);
        }
    }

    function _onIncomingTransfer(LogRecord calldata log_) internal {
        uint256 amount = abi.decode(log_.data, (uint256));
        if (amount < sweepMinAmount || amount == 0) return;
        sweepRequests += 1;
        _callback(
            abi.encodeWithSignature(
                "sweep(address,address,uint256,bytes32,uint256)",
                address(0),
                log_.contractAddress,
                amount,
                bytes32(log_.txHash),
                log_.logIndex
            )
        );
        emit SweepRequested(bytes32(log_.txHash), log_.logIndex, amount);
    }

    function _upsert(uint256 id, uint64 nextDue) internal {
        Mirror storage m = mirror[id];
        m.nextDue = nextDue;
        m.pendingSince = 0;
        if (!m.active) {
            if (_activeIds.length >= MAX_ACTIVE_ORDERS) return; // vault keeps it; it just won't auto-run
            m.active = true;
            _activeIds.push(id);
            _activeIndexPlusOne[id] = _activeIds.length;
        }
        emit OrderMirrored(id, nextDue, true);
        if (!cronSubscribed) _setCron(true);
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
        if (_activeIds.length == 0 && cronSubscribed) _setCron(false);
    }

    function _setSweepWatch(address token, uint256 minAmount, bool active) internal {
        if (sweepSubscribed) {
            SYSTEM.unsubscribe(
                destinationChainId,
                sweepToken,
                TRANSFER_TOPIC,
                REACTIVE_IGNORE,
                uint256(uint160(wallet)),
                REACTIVE_IGNORE
            );
            sweepSubscribed = false;
        }
        sweepToken = token;
        sweepMinAmount = minAmount;
        if (active) {
            SYSTEM.subscribe(
                destinationChainId,
                token,
                TRANSFER_TOPIC,
                REACTIVE_IGNORE,
                uint256(uint160(wallet)),
                REACTIVE_IGNORE
            );
            sweepSubscribed = true;
        }
        emit SweepWatchChanged(token, minAmount, active);
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
        emit CronToggled(cronTopic, on);
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
