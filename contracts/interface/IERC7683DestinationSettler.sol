// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IERC7683DestinationSettler {
    function fill(
        bytes32 orderId,
        bytes calldata originData,
        bytes calldata fillerData
    ) external;
}
