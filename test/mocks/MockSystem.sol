// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {ISystemContract} from "@reactive/src/interfaces/ISystemContract.sol";

/// @dev Local stand-in for Reactive's system contract (0x8888...8). Records subscriptions and callback requests.
contract MockSystem {
    struct Sub {
        uint256 chainId;
        address target;
        uint256 t0;
        uint256 t1;
        uint256 t2;
        uint256 t3;
    }

    mapping(bytes32 => bool) public subscribed;
    uint256 public subscribeCalls;
    uint256 public unsubscribeCalls;
    ISystemContract.CallbackConfiguration_V_1_0[] internal _callbacks;

    function subscribe(uint256 c, address a, uint256 t0, uint256 t1, uint256 t2, uint256 t3) external {
        subscribed[keccak256(abi.encode(msg.sender, c, a, t0, t1, t2, t3))] = true;
        subscribeCalls++;
    }

    function unsubscribe(uint256 c, address a, uint256 t0, uint256 t1, uint256 t2, uint256 t3) external {
        bytes32 k = keccak256(abi.encode(msg.sender, c, a, t0, t1, t2, t3));
        require(subscribed[k], "unsubscribe drift");
        subscribed[k] = false;
        unsubscribeCalls++;
    }

    function isSubscribed(address who, uint256 c, address a, uint256 t0, uint256 t1, uint256 t2, uint256 t3)
        external
        view
        returns (bool)
    {
        return subscribed[keccak256(abi.encode(who, c, a, t0, t1, t2, t3))];
    }

    function requestCallbackV_1_0(ISystemContract.CallbackConfiguration_V_1_0 memory config_) external {
        _callbacks.push(config_);
    }

    function callbackCount() external view returns (uint256) {
        return _callbacks.length;
    }

    function callbackAt(uint256 i)
        external
        view
        returns (ISystemContract.CallbackConfiguration_V_1_0 memory)
    {
        return _callbacks[i];
    }

    function debt(address) external pure returns (uint256) {
        return 0;
    }

    receive() external payable {}
}

/// @dev Local stand-in for a destination-chain callback proxy: injects the reactive sender into the first argument.
contract MockCallbackProxy {
    function deliver(address recipient, bytes memory payload, address reactiveSender)
        external
        returns (bool ok)
    {
        assembly {
            // payload layout: [len][selector(4)][arg0(32)]...; arg0 starts at payload+32+4
            mstore(add(payload, 36), reactiveSender)
        }
        (ok,) = recipient.call(payload);
        require(ok, "callback reverted");
    }

    function debt(address) external pure returns (uint256) {
        return 0;
    }

    receive() external payable {}
}
