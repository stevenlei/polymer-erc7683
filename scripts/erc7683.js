require("dotenv").config();
const hre = require("hardhat");
const { ethers } = require("hardhat");
const chalk = require("chalk");

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

  // Initiate 3 cross-chain increments
  console.log(chalk.yellow("\n🔄 Initiating 3 cross-chain increments..."));

  for (let i = 0; i < 3; i++) {
    console.log(chalk.yellow(`\n📝 Increment #${i + 1}`));
    const tx = await counter.incrementCrossChain(
      BigInt(destinationChainId), // uint64
      destinationSettlerBytes32, // bytes32
      fillDeadline // uint32
    );
    await tx.wait();
    console.log(chalk.green(`✅ Cross-chain increment #${i + 1} initiated!`));
    console.log(chalk.cyan(`📝 Transaction hash: ${chalk.bold(tx.hash)}`));
  }

  console.log(
    chalk.green("\n✅ All cross-chain increments initiated successfully!")
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
