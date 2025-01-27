require("dotenv").config();
const ethers = require("ethers");
const axios = require("axios");
const chalk = require("chalk");

const POLYMER_API_URL = "https://proof.sepolia.polymer.zone";

const { CHAINS } = require("../config/chains");

// Debug: Log available chains
console.log(chalk.yellow("\n📋 Available chains:"));
for (const [key, chain] of Object.entries(CHAINS)) {
  console.log(chalk.cyan(`>  ${key}: Chain ID ${chain.chainId}`));
}

// Contract ABI (only the events and functions we need)
const CONTRACT_ABI =
  require("../artifacts/contracts/CrossChainCounter.sol/CrossChainCounter.json").abi;

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
      chalk.blue(`>  Starting listener for ${chalk.bold(this.config.name)}...`)
    );
    console.log(
      chalk.cyan(
        `>  Contract address: ${chalk.bold(this.config.contractAddress)}`
      )
    );
    console.log(chalk.cyan(`>  Chain ID: ${chalk.bold(this.config.chainId)}`));

    // Get the latest block
    const latestBlock = await this.provider.getBlockNumber();
    console.log(
      chalk.yellow(`>  Current block number: ${chalk.bold(latestBlock)}`)
    );

    // Listen for FillerRepaid events
    this.contract.on("FillerRepaid", async (orderId, filler, event) => {
      console.log(
        chalk.green(
          `\n✅ Filler repayment confirmed for order ${chalk.bold(orderId)}`
        )
      );
      console.log(chalk.cyan(`>  Filler address: ${chalk.bold(filler)}`));
      console.log(
        chalk.cyan(
          `>  Transaction hash: ${chalk.bold(event.log.transactionHash)}`
        )
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
            `\n🔔 New Open event detected on ${chalk.bold(this.config.name)}:`
          )
        );
        console.log(chalk.cyan(`>  Order ID: ${chalk.bold(orderId)}`));
        console.log(chalk.cyan(`>  User: ${chalk.bold(resolvedOrder.user)}`));
        console.log(
          chalk.cyan(
            `>  Origin Chain ID: ${chalk.bold(resolvedOrder.originChainId)}`
          )
        );

        // Log the original structure of the Open event
        console.log(chalk.blue("\n📋 Open Event Structure:"));
        console.log(chalk.cyan("ResolvedCrossChainOrder:"));
        console.log(chalk.cyan(`>  User: ${chalk.bold(resolvedOrder.user)}`));
        console.log(
          chalk.cyan(
            `>  Origin Chain ID: ${chalk.bold(resolvedOrder.originChainId)}`
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
          console.log(chalk.yellow(`\n📝 Processing fill instruction:`));
          console.log(
            chalk.cyan(
              `>  Destination Chain ID: ${chalk.bold(
                instruction.destinationChainId
              )}`
            )
          );
          console.log(
            chalk.cyan(
              `>  Destination Settler: ${chalk.bold(
                instruction.destinationSettler
              )}`
            )
          );

          // Debug: Log chain lookup
          console.log(chalk.yellow("\n🔍 Looking for destination chain:"));
          console.log(
            chalk.cyan(
              `>  Searching for chain ID: ${instruction.destinationChainId}`
            )
          );
          console.log(
            chalk.cyan(
              ">  Available chain IDs:",
              Object.values(CHAINS).map((c) => c.chainId)
            )
          );

          // Get the destination chain configuration
          const destChain = Object.values(CHAINS).find(
            (chain) => chain.chainId === Number(instruction.destinationChainId)
          );

          if (!destChain) {
            console.log(
              chalk.red(
                `❌ Destination chain ${instruction.destinationChainId} not supported`
              )
            );
            console.log(
              chalk.yellow(
                ">  Type of destinationChainId:",
                typeof instruction.destinationChainId
              )
            );
            continue;
          }

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
          const fillReceipt = await fillTx.wait();
          console.log(chalk.green(`✅ Fill transaction confirmed!`));
          console.log(
            chalk.yellow(
              `ℹ️  Skipping repayment process - will be handled later in batch`
            )
          );

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
