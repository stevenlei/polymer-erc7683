// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./interface/IERC7683OriginSettler.sol";
import "./interface/IERC7683DestinationSettler.sol";
import "./interface/IPolymerProver.sol";

import "./library/RLPReader.sol";
import "./library/RLPParser.sol";

// Counter Message subtype definition
struct CounterMessage {
    uint256 incrementAmount;
}

contract CrossChainCounter is
    IERC7683OriginSettler,
    IERC7683DestinationSettler
{
    using RLPParser for bytes;
    using RLPParser for RLPReader.RLPItem[];

    IPolymerProver public immutable polymerProver;

    // Structure to store pending repayments
    struct PendingRepayment {
        bytes32 orderId;
        address filler;
        bool processed;
    }

    uint256 public counter;

    mapping(bytes32 => bool) public processedOrders;
    mapping(uint256 => uint256) private paidOrdersBitmap;
    mapping(bytes32 => bool) public isQueued;
    mapping(bytes32 => bool) public processedRepaymentBatches;

    // Array to store pending repayments
    PendingRepayment[] public pendingRepayments;

    bytes32 public constant ORDER_TYPE_HASH =
        keccak256("CounterMessage(uint256 incrementAmount)");

    bytes32 public constant REPAYMENT_TYPEHASH =
        keccak256("PendingRepayment(bytes32 orderId,address filler)");

    event FillerRepaidBatch(bytes32[] orderIds, address[] fillers);
    event RepaymentBatchExecuted(
        bytes32 indexed batchHash,
        uint256 indexed startIndex,
        uint256 indexed endIndex
    );

    constructor(address _polymerProver) {
        counter = 0;
        polymerProver = IPolymerProver(_polymerProver);
    }

    // Function to increment counter locally
    function increment() external {
        counter += 1;
    }

    // Function to initiate cross-chain increment
    function incrementCrossChain(
        uint64 destinationChainId,
        bytes32 destinationSettler,
        uint32 fillDeadline
    ) external {
        // Create the counter message
        CounterMessage memory message = CounterMessage({incrementAmount: 1});

        bytes memory orderData = abi.encode(message);

        OnchainCrossChainOrder memory order = OnchainCrossChainOrder({
            fillDeadline: fillDeadline,
            orderDataType: ORDER_TYPE_HASH,
            orderData: orderData
        });

        // Create the resolved order
        Output[] memory maxSpent = new Output[](0);
        Output[] memory minReceived = new Output[](0);

        FillInstruction[] memory fillInstructions = new FillInstruction[](1);
        fillInstructions[0] = FillInstruction({
            destinationChainId: destinationChainId,
            destinationSettler: destinationSettler,
            originData: orderData
        });

        // Add uniqueness to orderId by including block.timestamp and msg.sender
        bytes32 orderId = keccak256(
            abi.encode(order, block.timestamp, msg.sender)
        );

        ResolvedCrossChainOrder memory resolvedOrder = ResolvedCrossChainOrder({
            user: msg.sender,
            originChainId: block.chainid,
            openDeadline: uint32(block.timestamp + 3600), // 1 hour from now
            fillDeadline: fillDeadline,
            orderId: orderId,
            maxSpent: maxSpent,
            minReceived: minReceived,
            fillInstructions: fillInstructions
        });

        // Emit the Open event
        emit Open(orderId, resolvedOrder);
    }

    // Queue a repayment for batch processing
    function queueRepayment(bytes32 orderId, address filler) internal {
        require(!isQueued[orderId], "Repayment already queued");
        require(!_isOrderPaid(orderId), "Order already paid");

        pendingRepayments.push(
            PendingRepayment({
                orderId: orderId,
                filler: filler,
                processed: false
            })
        );

        isQueued[orderId] = true;
    }

    // Generate hash for a batch of pending repayments
    function generateRepaymentBatchHash()
        public
        view
        returns (bytes32, uint256, uint256)
    {
        bytes32[] memory repaymentHashes = new bytes32[](
            pendingRepayments.length
        );
        uint256 unprocessedCount = 0;
        uint256 startIndex;
        uint256 endIndex;
        bool foundStart = false;

        for (uint256 i = 0; i < pendingRepayments.length; i++) {
            PendingRepayment storage repayment = pendingRepayments[i];
            if (!repayment.processed) {
                if (!foundStart) {
                    startIndex = i;
                    foundStart = true;
                }
                endIndex = i;
                repaymentHashes[unprocessedCount] = keccak256(
                    abi.encode(
                        REPAYMENT_TYPEHASH,
                        repayment.orderId,
                        repayment.filler
                    )
                );
                unprocessedCount++;
            }
        }

        if (unprocessedCount == 0) {
            return (bytes32(0), 0, 0);
        }

        // Resize the array to only include unprocessed repayments
        assembly {
            mstore(repaymentHashes, unprocessedCount)
        }

        bytes32 batchHash = keccak256(abi.encodePacked(repaymentHashes));
        return (batchHash, startIndex, endIndex);
    }

    // Execute repayments on destination chain
    function executeRepayments() external {
        (
            bytes32 batchHash,
            uint256 startIndex,
            uint256 endIndex
        ) = generateRepaymentBatchHash();
        require(batchHash != bytes32(0), "No pending repayments");

        // Mark all pending repayments as processed
        for (uint256 i = startIndex; i <= endIndex; i++) {
            if (!pendingRepayments[i].processed) {
                pendingRepayments[i].processed = true;
            }
        }

        // Emit a single event with the batch hash and indices
        emit RepaymentBatchExecuted(batchHash, startIndex, endIndex);
    }

    // Helper function to check if order is paid using bitmap
    function _isOrderPaid(bytes32 orderId) internal view returns (bool) {
        uint256 index = uint256(orderId) / 256;
        uint256 bit = uint256(orderId) % 256;
        return (paidOrdersBitmap[index] & (1 << bit)) != 0;
    }

    // Helper function to mark order as paid using bitmap
    function _markOrderPaid(bytes32 orderId) internal {
        uint256 index = uint256(orderId) / 256;
        uint256 bit = uint256(orderId) % 256;
        paidOrdersBitmap[index] |= (1 << bit);
    }

    // Process multiple repayments on origin chain
    function repayFillers(
        bytes calldata proof,
        PendingRepayment[] calldata repaymentData
    ) external {
        // Validate the receipt containing the RepaymentBatchExecuted event
        (, bytes memory rlpEncodedBytes) = polymerProver.validateReceipt(proof);

        // Parse the receipt to get logs array
        RLPReader.RLPItem[] memory logs = RLPParser.parseReceipt(
            rlpEncodedBytes
        );

        // Event signature for RepaymentBatchExecuted
        bytes32 REPAYMENT_BATCH_EXECUTED_SIG = keccak256(
            "RepaymentBatchExecuted(bytes32,uint256,uint256)"
        );

        bytes32 providedBatchHash = generateBatchHashFromData(repaymentData);
        bool foundValidBatch = false;

        // Process each log
        uint256 logsLength = logs.length;
        for (uint256 i = 0; i < logsLength; ) {
            RLPReader.RLPItem[] memory logItems = RLPReader.readList(logs[i]);

            bytes[] memory topics;
            bytes memory data;
            (topics, data) = RLPParser.parseLog(
                logItems,
                REPAYMENT_BATCH_EXECUTED_SIG
            );

            // Check if the batch hash in topics[1] matches our provided hash
            if (
                bytes32(topics[1]) == providedBatchHash &&
                !processedRepaymentBatches[providedBatchHash]
            ) {
                foundValidBatch = true;
                processedRepaymentBatches[providedBatchHash] = true;
                break;
            }
            unchecked {
                ++i;
            }
        }

        require(foundValidBatch, "No valid batch hash found in proof");

        // Create arrays for batch event
        uint256 length = repaymentData.length;
        bytes32[] memory orderIds = new bytes32[](length);
        address[] memory fillers = new address[](length);

        // Process each repayment
        for (uint256 i = 0; i < length; ) {
            bytes32 orderId = repaymentData[i].orderId;
            address filler = repaymentData[i].filler;

            require(!_isOrderPaid(orderId), "Order already paid");
            _markOrderPaid(orderId);

            orderIds[i] = orderId;
            fillers[i] = filler;

            unchecked {
                ++i;
            }
        }

        // Emit single batch event instead of multiple events
        emit FillerRepaidBatch(orderIds, fillers);
    }

    // Helper function to generate batch hash from provided data
    function generateBatchHashFromData(
        PendingRepayment[] calldata repayments
    ) public pure returns (bytes32) {
        bytes32[] memory repaymentHashes = new bytes32[](repayments.length);

        for (uint256 i = 0; i < repayments.length; i++) {
            repaymentHashes[i] = keccak256(
                abi.encode(
                    REPAYMENT_TYPEHASH,
                    repayments[i].orderId,
                    repayments[i].filler
                )
            );
        }

        return keccak256(abi.encodePacked(repaymentHashes));
    }

    // Implementation of IERC7683DestinationSettler
    function fill(
        bytes32 orderId,
        bytes calldata originData,
        bytes calldata /* fillerData */
    ) external override {
        require(!processedOrders[orderId], "Order already processed");

        // Decode the counter message from originData
        CounterMessage memory message = abi.decode(
            originData,
            (CounterMessage)
        );

        processedOrders[orderId] = true;
        counter += message.incrementAmount;

        // Queue the repayment automatically when fill is called
        queueRepayment(orderId, msg.sender);
    }

    // Implementation of IERC7683OriginSettler
    function openFor(
        GaslessCrossChainOrder calldata /* order */,
        bytes calldata /* signature */,
        bytes calldata /* originFillerData */
    ) external pure override {
        revert("Not implemented");
    }

    function open(
        OnchainCrossChainOrder calldata /* order */
    ) external pure override {
        // This is handled in incrementCrossChain
        revert("Use incrementCrossChain instead");
    }

    function resolveFor(
        GaslessCrossChainOrder calldata /* order */,
        bytes calldata /* originFillerData */
    ) external pure override returns (ResolvedCrossChainOrder memory) {
        revert("Not implemented");
    }

    function resolve(
        OnchainCrossChainOrder calldata /* order */
    ) external pure override returns (ResolvedCrossChainOrder memory) {
        revert("Not implemented");
    }
}
