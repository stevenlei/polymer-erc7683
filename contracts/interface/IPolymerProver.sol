// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IPolymerProver {
    function validateEvent(
        uint256 logIndex,
        bytes calldata proof
    )
        external
        view
        returns (
            string memory chainId,
            address emittingContract,
            bytes[] memory topics,
            bytes memory data
        );

    function validateReceipt(
        bytes calldata proof
    ) external view returns (bytes32 chainID, bytes memory rlpEncodedBytes);
}
