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

class ChainListener {
  constructor(chainConfig, wallet) {
    this.config = chainConfig;
    this.provider = new ethers.JsonRpcProvider(chainConfig.rpcUrl);
    this.wallet = wallet.connect(this.provider);
    this.contract = new ethers.Contract(
      chainConfig.contractAddress,
      CONTRACT_ABI,
      this.wallet
    );

    // Keep track of processed orders to avoid duplicates
    this.processedOrders = new Set();
  }

  async start() {
    console.log(
      chalk.blue(`[${chalk.bold(this.config.name)}] Starting listener...`)
    );
    console.log(
      chalk.cyan(
        `[${chalk.bold(this.config.name)}] Contract address: ${chalk.bold(
          this.config.contractAddress
        )}`
      )
    );

    // Get the latest block
    const latestBlock = await this.provider.getBlockNumber();
    console.log(
      chalk.yellow(
        `[${chalk.bold(this.config.name)}] Current block number: ${chalk.bold(
          latestBlock
        )}`
      )
    );

    // Listen for FillerRepaidBatch events
    this.contract.on("FillerRepaidBatch", async (orderIds, fillers, event) => {
      console.log(chalk.cyan("\n📦 Batch repayment detected!"));
      console.log(chalk.cyan(`Transaction Hash: ${event.transactionHash}`));
      console.log(chalk.cyan(`Block Number: ${event.blockNumber}`));

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
        // Create a unique event identifier
        const eventId = `${event.log.blockHash}-${event.log.transactionHash}-${event.log.index}`;

        // Skip if we've already processed this event
        if (this.processedOrders.has(eventId)) {
          return;
        }

        console.log(
          chalk.blue(
            `\n🔔 [${chalk.bold(this.config.name)}] Event 'Open' detected`
          )
        );
        console.log(chalk.cyan(`>  Order ID: ${chalk.bold(orderId)}`));
        console.log(chalk.cyan(`>  User: ${chalk.bold(resolvedOrder.user)}`));

        // Find origin chain name
        const originChain = Object.values(CHAINS).find(
          (chain) => chain.chainId === Number(resolvedOrder.originChainId)
        );
        const originChainName = originChain
          ? originChain.name
          : "Unknown Chain";

        console.log(
          chalk.cyan(
            `>  Origin Chain ID: ${chalk.bold(
              resolvedOrder.originChainId
            )} (${chalk.bold(originChainName)})`
          )
        );

        // Log the original structure of the Open event
        console.log(
          chalk.blue(`\n📋 [${originChainName}] Event 'Open' Structure:`)
        );
        console.log(chalk.cyan("ResolvedCrossChainOrder:"));
        console.log(chalk.cyan(`>  User: ${chalk.bold(resolvedOrder.user)}`));
        console.log(
          chalk.cyan(
            `>  Origin Chain ID: ${chalk.bold(
              resolvedOrder.originChainId
            )} (${originChainName})`
          )
        );
        console.log(
          chalk.cyan(
            `>  Open Deadline: ${chalk.bold(resolvedOrder.openDeadline)}`
          )
        );
        console.log(
          chalk.cyan(
            `>  Fill Deadline: ${chalk.bold(resolvedOrder.fillDeadline)}`
          )
        );
        console.log(
          chalk.cyan(`>  Order ID: ${chalk.bold(resolvedOrder.orderId)}`)
        );

        // Process each fill instruction
        for (const instruction of resolvedOrder.fillInstructions) {
          const destChain = Object.values(CHAINS).find(
            (chain) => chain.chainId === Number(instruction.destinationChainId)
          );
          const destChainName = destChain ? destChain.name : "Unknown Chain";

          console.log(
            chalk.yellow(`\n📝 [${destChainName}] Processing fill instruction:`)
          );

          console.log(
            chalk.cyan(
              `>  Destination Chain ID: ${chalk.bold(
                instruction.destinationChainId
              )} (${destChainName})`
            )
          );
          console.log(
            chalk.cyan(
              `>  Destination Settler: ${chalk.bold(
                instruction.destinationSettler
              )}`
            )
          );

          // Connect to destination chain
          const destProvider = new ethers.JsonRpcProvider(destChain.rpcUrl);
          const destWallet = this.wallet.connect(destProvider);
          const destContract = new ethers.Contract(
            destChain.contractAddress,
            CONTRACT_ABI,
            destWallet
          );

          // Fill the order on the destination chain
          const fillTx = await destContract.fill(
            orderId,
            instruction.originData,
            "0x" // Empty filler data
          );

          console.log(chalk.green(`✅ Fill transaction sent: ${fillTx.hash}`));
          await fillTx.wait();
          console.log(chalk.green(`✅ Fill transaction confirmed!`));

          // Mark this event as processed
          this.processedOrders.add(eventId);
        }
      } catch (error) {
        console.error(chalk.red("❌ Error processing event:"), error);
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
    listeners.push(new ChainListener(chain, wallet));
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
