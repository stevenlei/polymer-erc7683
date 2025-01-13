// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IERC7683OriginSettler {
    struct GaslessCrossChainOrder {
        address originSettler;
        address user;
        uint256 nonce;
        uint256 originChainId;
        uint32 openDeadline;
        uint32 fillDeadline;
        bytes32 orderDataType;
        bytes orderData;
    }

    struct OnchainCrossChainOrder {
        uint32 fillDeadline;
        bytes32 orderDataType;
        bytes orderData;
    }

    struct ResolvedCrossChainOrder {
        address user;
        uint256 originChainId;
        uint32 openDeadline;
        uint32 fillDeadline;
        bytes32 orderId;
        Output[] maxSpent;
        Output[] minReceived;
        FillInstruction[] fillInstructions;
    }

    struct Output {
        bytes32 token;
        uint256 amount;
        bytes32 recipient;
        uint256 chainId;
    }

    struct FillInstruction {
        uint64 destinationChainId;
        bytes32 destinationSettler;
        bytes originData;
    }

    event Open(bytes32 indexed orderId, ResolvedCrossChainOrder resolvedOrder);
    
    function openFor(GaslessCrossChainOrder calldata order, bytes calldata signature, bytes calldata originFillerData) external;
    function open(OnchainCrossChainOrder calldata order) external;
    function resolveFor(GaslessCrossChainOrder calldata order, bytes calldata originFillerData) external view returns (ResolvedCrossChainOrder memory);
    function resolve(OnchainCrossChainOrder calldata order) external view returns (ResolvedCrossChainOrder memory);
}

interface IERC7683DestinationSettler {
    function fill(bytes32 orderId, bytes calldata originData, bytes calldata fillerData) external;
}

// Counter Message subtype definition
struct CounterMessage {
    uint256 incrementAmount;
}

contract CrossChainCounter is IERC7683OriginSettler, IERC7683DestinationSettler {
    uint256 public counter;
    mapping(bytes32 => bool) public processedOrders;
    bytes32 public constant ORDER_TYPE_HASH = keccak256("CounterMessage(uint256 incrementAmount)");

    event CounterIncremented(uint256 newValue, uint256 originChainId);
    event CrossChainIncrementInitiated(bytes32 orderId);

    constructor() {
        counter = 0;
    }

    // Function to increment counter locally
    function increment() external {
        counter += 1;
        emit CounterIncremented(counter, block.chainid);
    }

    // Function to initiate cross-chain increment
    function incrementCrossChain(
        uint64 destinationChainId,
        bytes32 destinationSettler,
        uint32 fillDeadline
    ) external {
        // Create the counter message
        CounterMessage memory message = CounterMessage({
            incrementAmount: 1
        });
        
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

        bytes32 orderId = keccak256(abi.encode(order));
        
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
        emit CrossChainIncrementInitiated(orderId);
    }

    // Implementation of IERC7683DestinationSettler
    function fill(
        bytes32 orderId,
        bytes calldata originData,
        bytes calldata /* fillerData */
    ) external override {
        require(!processedOrders[orderId], "Order already processed");
        
        // Decode the counter message from originData
        CounterMessage memory message = abi.decode(originData, (CounterMessage));
        
        processedOrders[orderId] = true;
        counter += message.incrementAmount;
        emit CounterIncremented(counter, block.chainid);
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
