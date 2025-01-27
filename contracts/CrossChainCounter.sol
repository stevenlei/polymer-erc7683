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
    mapping(bytes32 => bool) public paidOrders;
    mapping(bytes32 => bool) public isQueued;

    // Array to store pending repayments
    PendingRepayment[] public pendingRepayments;

    bytes32 public constant ORDER_TYPE_HASH =
        keccak256("CounterMessage(uint256 incrementAmount)");

    event FillerRepaid(bytes32 orderId, address filler);
    event RepaymentExecuted(bytes32 indexed orderId, address indexed filler);

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
        require(!paidOrders[orderId], "Order already paid");

        pendingRepayments.push(
            PendingRepayment({
                orderId: orderId,
                filler: filler,
                processed: false
            })
        );

        isQueued[orderId] = true;
    }

    // Execute all pending repayments
    function executeRepayments() external {
        for (uint256 i = 0; i < pendingRepayments.length; i++) {
            PendingRepayment storage repayment = pendingRepayments[i];
            if (!repayment.processed) {
                repayment.processed = true;

                // We will emit all pending RepaymentExecuted events into a single transaction receipt
                // So that we can validate all events in the receipt using Polymer prover on the origin chain
                emit RepaymentExecuted(repayment.orderId, repayment.filler);
            }
        }
    }

    // Process multiple repayments on origin chain
    function repayFillers(bytes calldata proof) external {
        // Validate the receipt containing multiple RepaymentExecuted events
        (, bytes memory rlpEncodedBytes) = polymerProver.validateReceipt(proof);

        // Parse the receipt to get logs array
        RLPReader.RLPItem[] memory logs = RLPParser.parseReceipt(
            rlpEncodedBytes
        );

        // Event signature for RepaymentExecuted
        bytes32 REPAYMENT_EXECUTED_SIG = keccak256(
            "RepaymentExecuted(bytes32,address)"
        );

        // Process each log
        for (uint256 i = 0; i < logs.length; i++) {
            // Parse the log structure: [address, topics[], data]
            RLPReader.RLPItem[] memory logItems = RLPReader.readList(logs[i]);

            // Parse the log to get topics and data
            (bytes[] memory topics, ) = RLPParser.parseLog(
                logItems,
                REPAYMENT_EXECUTED_SIG
            );

            // Extract orderId and filler from topics
            bytes32 orderId = bytes32(topics[1]);
            address filler = address(uint160(uint256(bytes32(topics[2]))));

            emit FillerRepaid(orderId, filler);
        }
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
