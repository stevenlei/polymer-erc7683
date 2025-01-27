// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./RLPReader.sol";

/// @title RLPParser
/// @notice A library for parsing RLP-encoded receipts and logs
/// @dev Uses RLPReader for low-level RLP decoding
library RLPParser {
    /// @notice Parse a single log entry and return topics and data
    /// @param logItems The RLP-decoded log items array [address, topics[], data]
    /// @param expectedEventSig The expected event signature to validate against
    /// @return topics Array of topic bytes
    /// @return data Unindexed event data
    function parseLog(
        RLPReader.RLPItem[] memory logItems,
        bytes32 expectedEventSig
    ) internal pure returns (bytes[] memory topics, bytes memory data) {
        require(logItems.length >= 3, "Log must have at least 3 items");

        // Get topics array
        RLPReader.RLPItem[] memory encodedTopics = RLPReader.readList(
            logItems[1]
        );
        require(encodedTopics.length > 0, "Log must have at least 1 topic");

        // Convert RLP items to bytes array
        topics = new bytes[](encodedTopics.length);
        for (uint256 i = 0; i < encodedTopics.length; i++) {
            topics[i] = RLPReader.readBytes(encodedTopics[i]);
        }

        // Verify this is the expected event
        require(
            bytes32(topics[0]) == expectedEventSig,
            "Invalid event signature"
        );

        // Get unindexed data
        data = RLPReader.readBytes(logItems[2]);
    }

    /// @notice Parse RLP encoded receipt and return the logs array
    /// @param rlpEncodedBytes The RLP-encoded receipt bytes
    /// @return logs Array of RLP-decoded log items
    function parseReceipt(
        bytes memory rlpEncodedBytes
    ) internal pure returns (RLPReader.RLPItem[] memory logs) {
        // Get the first byte to check if it's a typed receipt
        uint8 firstByte = uint8(bytes1(rlpEncodedBytes[0]));

        // Strip the type byte if it's < 0x80
        bytes memory strippedBytes;
        if (firstByte < 0x80) {
            // Typed receipt: strip the type byte
            strippedBytes = new bytes(rlpEncodedBytes.length - 1);
            for (uint i = 0; i < strippedBytes.length; i++) {
                strippedBytes[i] = rlpEncodedBytes[i + 1];
            }
        } else {
            strippedBytes = rlpEncodedBytes;
        }

        // Parse the receipt using RLPReader
        RLPReader.RLPItem memory item = RLPReader.toRLPItem(strippedBytes);
        RLPReader.RLPItem[] memory receipt = RLPReader.readList(item);
        require(receipt.length >= 4, "Receipt must have at least 4 items");

        // Get the logs array (4th item)
        logs = RLPReader.readList(receipt[3]);
        require(logs.length > 0, "No logs found in receipt");
    }
}
