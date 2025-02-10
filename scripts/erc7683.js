require("dotenv").config();
const hre = require("hardhat");
const { ethers } = require("hardhat");
const chalk = require("chalk");
const readline = require("readline");

// Create readline interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Promisify readline question
const question = (query) => new Promise((resolve) => rl.question(query, resolve));

async function main() {
  const networkName = hre.network.name;
  const chainId = hre.network.config.chainId;

  console.log(
    chalk.blue(
      `🌐 Connected to network: ${chalk.bold(networkName)} (${chainId})`
    )
  );

  // Get contract address from .env based on network
  const networkToEnvKey = {
    optimismSepolia: "OPTIMISM_SEPOLIA_CONTRACT_ADDRESS",
    baseSepolia: "BASE_SEPOLIA_CONTRACT_ADDRESS",
  };

  const envKey = networkToEnvKey[networkName];
  const contractAddress = process.env[envKey];

  console.log(
    chalk.blue(`📄 Using contract address: ${chalk.bold(contractAddress)}`)
  );

  // Prompt user for number of transactions
  const answer = await question(chalk.yellow("\n💭 How many transactions would you like to send? (default: 3) "));
  const numTx = answer ? parseInt(answer) : 3;

  if (isNaN(numTx) || numTx < 1) {
    console.log(
      chalk.red("❌ Please provide a valid number of transactions (>= 1)")
    );
    rl.close();
    process.exit(1);
  }

  // Ask for confirmation
  const confirmation = await question(
    chalk.yellow(`\n⚠️  You are about to send ${numTx} transaction${numTx > 1 ? "s" : ""}. Proceed? (y/N) `)
  );

  if (confirmation.toLowerCase() !== 'y') {
    console.log(chalk.yellow("\n🛑 Operation cancelled by user"));
    rl.close();
    process.exit(0);
  }

  console.log(
    chalk.blue(
      `\n🚀 Preparing to send ${numTx} transaction${numTx > 1 ? "s" : ""}...`
    )
  );

  // Get contract instance
  const CrossChainCounter = await ethers.getContractFactory(
    "CrossChainCounter"
  );
  const counter = await CrossChainCounter.attach(contractAddress);

  // Get destination chain and settler based on current chain
  let destinationChainId, destinationSettler;

  if (chainId === 11155420) {
    // Optimism Sepolia
    destinationChainId = 84532; // Base Sepolia
    destinationSettler = process.env.BASE_SEPOLIA_CONTRACT_ADDRESS;
  } else if (chainId === 84532) {
    // Base Sepolia
    destinationChainId = 11155420; // Optimism Sepolia
    destinationSettler = process.env.OPTIMISM_SEPOLIA_CONTRACT_ADDRESS;
  } else {
    throw new Error(
      "Please use either Optimism Sepolia or Base Sepolia for this example"
    );
  }

  // Convert address to bytes32
  const destinationSettlerBytes32 = ethers.hexlify(
    ethers.concat([
      new Uint8Array(12), // 12 bytes of zeros
      ethers.getAddress(destinationSettler), // 20 bytes of address
    ])
  );

  const fillDeadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now

  // Initiate cross-chain increments in parallel
  console.log(
    chalk.yellow("\n🔄 Initiating cross-chain increments in parallel...")
  );

  const incrementPromises = Array(numTx)
    .fill()
    .map(async (_, i) => {
      console.log(chalk.yellow(`\n📝 Preparing increment #${i + 1}`));

      // Get nonce for this transaction
      const wallet = await ethers.provider.getSigner();
      const currentNonce = await wallet.getNonce();

      const tx = await counter.incrementCrossChain(
        BigInt(destinationChainId), // uint64
        destinationSettlerBytes32, // bytes32
        fillDeadline, // uint32
        { nonce: currentNonce + i } // Explicitly set nonce
      );

      return { tx, index: i + 1 };
    });

  // Wait for all transactions to be submitted
  const results = await Promise.all(incrementPromises);

  // Wait for all transactions to be mined in parallel
  await Promise.all(
    results.map(async ({ tx, index }) => {
      await tx.wait();
      console.log(chalk.green(`✅ Cross-chain increment #${index} confirmed!`));
      console.log(chalk.cyan(`📝 Transaction hash: ${chalk.bold(tx.hash)}`));
    })
  );

  console.log(
    chalk.green("\n✅ All cross-chain increments confirmed successfully!")
  );

  // Close readline interface before exiting
  rl.close();
}

main().catch((error) => {
  console.error(error);
  rl.close();
  process.exit(1);
});
