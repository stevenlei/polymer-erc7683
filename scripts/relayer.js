require("dotenv").config();
const ethers = require("ethers");
const chalk = require("chalk");

const { CHAINS } = require("../config/chains");

// Contract ABI (only the functions we need)
const CONTRACT_ABI = [
  // ERC7683 events
  "event Open(bytes32 indexed orderId, tuple(address user, uint256 originChainId, uint32 openDeadline, uint32 fillDeadline, bytes32 orderId, tuple(bytes32 token, uint256 amount, bytes32 recipient, uint256 chainId)[] maxSpent, tuple(bytes32 token, uint256 amount, bytes32 recipient, uint256 chainId)[] minReceived, tuple(uint64 destinationChainId, bytes32 destinationSettler, bytes originData)[] fillInstructions) resolvedOrder)",
  "event Fill(bytes32 indexed orderId, address indexed filler, bytes fillerData)",
  "event Execute(bytes32 indexed orderId, bool indexed success, bytes message)",
  "event Cancel(bytes32 indexed orderId)",
  // ERC7683 functions
  "function fill(bytes32 orderId, bytes calldata originData, bytes calldata fillerData) external",
  "function openFor(tuple(address originSettler, address user, uint256 nonce, uint256 originChainId, uint32 openDeadline, uint32 fillDeadline, bytes32 orderDataType, bytes orderData) order, bytes calldata signature, bytes calldata originFillerData) external",
  "function execute(bytes32 orderId, bytes calldata proof) external",
  "function cancel(bytes32 orderId) external",
  // Custom contract events and functions
  "function repayFillers(bytes calldata proof, tuple(bytes32 orderId, address filler, bool processed)[] calldata repaymentData) external",
  "function pendingRepayments(uint256 index) external view returns (tuple(bytes32 orderId, address filler, bool processed))",
  "event FillerRepaidBatch(bytes32[] orderIds, address[] fillers)",
  "event RepaymentBatchExecuted(bytes32 indexed batchHash, uint256 indexed startIndex, uint256 indexed endIndex)",
];

// Create a shared event tracker across all chains
const sharedEventTracker = new Set();

// Create a mapping of chain listeners for cross-chain operations
let chainListeners = {};

class ChainListener {
  constructor(config) {
    this.config = config;
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
    this.wallet = new ethers.Wallet(process.env.PRIVATE_KEY, this.provider);
    this.contract = new ethers.Contract(
      config.contractAddress,
      CONTRACT_ABI,
      this.wallet
    );

    // Store this listener in the global mapping
    chainListeners[config.chainId] = this;

    // Track processed orders per chain
    this.processedOrders = new Set();
  }

  async start() {
    console.log(
      chalk.blue(`\n🚀 Starting relayer for ${chalk.bold(this.config.name)}...`)
    );

    // Keep track of the last nonce used
    this.lastNonce = await this.wallet.getNonce();

    // Listen for FillerRepaidBatch events
    this.contract.on("FillerRepaidBatch", async (orderIds, fillers, event) => {
      console.log(chalk.cyan("\n📦 Batch repayment detected!"));
      console.log(chalk.cyan(`Transaction Hash: ${event.log.transactionHash}`));
      console.log(chalk.cyan(`Block Number: ${event.log.blockNumber}`));

      console.log(chalk.cyan("\nRepayments in batch:"));
      for (let i = 0; i < orderIds.length; i++) {
        console.log(chalk.cyan(`\nRepayment ${i + 1}:`));
        console.log(chalk.cyan(`  Order ID: ${orderIds[i]}`));
        console.log(chalk.cyan(`  Filler: ${fillers[i]}`));
      }

      console.log(
        chalk.green(`\n✅ Successfully processed ${orderIds.length} repayments`)
      );
    });

    // Listen for Open events from the Origin Settler
    this.contract.on("Open", async (orderId, resolvedOrder, event) => {
      try {
        console.log(chalk.cyan("\nEvent Details:"));
        console.log(
          chalk.cyan(">  Transaction Hash:", event.log.transactionHash)
        );
        console.log(chalk.cyan(">  Block Number:", event.log.blockNumber));
        console.log(chalk.cyan(">  Log Index:", event.log.index));
        console.log(chalk.cyan(">  Order ID:", orderId));

        // Convert BigInt to string in resolvedOrder for logging
        const resolvedOrderForLog = JSON.parse(
          JSON.stringify(resolvedOrder, (_, value) =>
            typeof value === "bigint" ? value.toString() : value
          )
        );

        // Create unique event identifier using all available data
        const eventId = `${event.log.transactionHash}-${event.log.blockNumber}-${event.log.index}`;

        // Skip if we've already processed this exact event
        if (this.processedOrders.has(eventId)) {
          console.log(
            chalk.yellow(
              `\n⚠️ Event ${eventId} already processed on ${this.config.name}, skipping...`
            )
          );
          return;
        }

        // Mark this event as processed immediately to prevent duplicates
        this.processedOrders.add(eventId);

        console.log(
          chalk.yellow(`\n📝 New order detected on ${this.config.name}:`)
        );
        console.log(chalk.cyan(`>  Order ID: ${chalk.bold(orderId)}`));
        console.log(chalk.cyan(`>  Event ID: ${chalk.bold(eventId)}`));
        console.log(
          chalk.cyan(
            `>  Source Chain: ${chalk.bold(this.config.name)} (${
              this.config.chainId
            })`
          )
        );

        // Extract fill instructions from the resolved order
        const fillInstructions = resolvedOrder.fillInstructions;

        if (!fillInstructions || fillInstructions.length === 0) {
          console.log(chalk.yellow("⚠️ No fill instructions found in order"));
          return;
        }

        // Process each fill instruction
        for (const instruction of fillInstructions) {
          const destinationChainId = Number(instruction.destinationChainId);
          const destinationSettler = `0x${instruction.destinationSettler.slice(
            26
          )}`;

          // Get the destination chain listener
          const destinationListener = chainListeners[destinationChainId];

          if (!destinationListener) {
            console.log(
              chalk.red(
                `❌ No listener found for destination chain ${destinationChainId}`
              )
            );
            continue;
          }

          try {
            // Get the next nonce for the destination chain
            const nonce = destinationListener.lastNonce++;

            // Generate a unique orderId for this fill using event details
            const uniqueOrderId = ethers.keccak256(
              ethers.AbiCoder.defaultAbiCoder().encode(
                ["bytes32", "bytes32", "uint256", "uint256"],
                [
                  orderId,
                  event.log.transactionHash,
                  event.log.blockNumber,
                  BigInt(event.log.index || 0),
                ]
              )
            );

            console.log(chalk.blue("\nExecuting fill on destination chain:"));
            console.log(
              chalk.cyan(`>  Chain: ${destinationListener.config.name}`)
            );
            console.log(chalk.cyan(`>  Original Order ID: ${orderId}`));
            console.log(chalk.cyan(`>  Unique Order ID: ${uniqueOrderId}`));
            console.log(chalk.cyan(`>  Event ID: ${eventId}`));
            console.log(chalk.cyan(`>  Nonce: ${nonce}`));

            // Call fill with the unique orderId
            const tx = await destinationListener.contract.fill(
              uniqueOrderId,
              instruction.originData,
              "0x",
              { nonce }
            );

            console.log(
              chalk.green(
                `📤 Fill transaction sent on ${
                  destinationListener.config.name
                }: ${chalk.bold(tx.hash)}`
              )
            );

            // Wait for transaction confirmation
            const receipt = await tx.wait();

            // Check if transaction was successful
            if (receipt.status === 0) {
              throw new Error("Transaction failed");
            }

            console.log(
              chalk.green(
                `✅ Fill transaction confirmed on ${
                  destinationListener.config.name
                }: ${chalk.bold(tx.hash)}`
              )
            );

            // Mark this fill instruction as processed only if successful
            sharedEventTracker.add(eventId);
          } catch (error) {
            console.log(
              chalk.red(`❌ Error processing fill: ${error.message}`)
            );
            // Reset nonce on error
            destinationListener.lastNonce =
              await destinationListener.wallet.getNonce();
            throw error;
          }
        }
      } catch (error) {
        console.log(chalk.red(`❌ Error processing event: ${error.message}`));
      }
    });
  }
}

async function main() {
  // Load wallet from private key
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY);
  console.log(
    chalk.cyan(`🔑 Using wallet address: ${chalk.bold(wallet.address)}`)
  );

  // Create listeners for each chain
  const listeners = [];
  for (const chain of Object.values(CHAINS)) {
    listeners.push(new ChainListener(chain));
  }

  // Start all listeners
  await Promise.all(listeners.map((listener) => listener.start()));
  console.log(chalk.green("\n✅ All listeners started successfully!"));
  console.log(chalk.yellow("⏳ Waiting for events..."));
}

// Start the relayer
main().catch((error) => {
  console.error(chalk.red("❌ Fatal error:"), error);
  process.exit(1);
});
