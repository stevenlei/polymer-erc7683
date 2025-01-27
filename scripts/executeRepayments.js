require("dotenv").config();
const hre = require("hardhat");
const { ethers } = require("hardhat");
const chalk = require("chalk");

async function main() {
  // Ensure we're on Base Sepolia
  const networkName = hre.network.name;
  const chainId = hre.network.config.chainId;

  if (chainId !== 84532) {
    throw new Error("This script must be run on Base Sepolia network");
  }

  console.log(
    chalk.blue(
      `🌐 Connected to network: ${chalk.bold(networkName)} (${chainId})`
    )
  );

  // Get contract address for Base Sepolia
  const contractAddress = process.env.BASE_SEPOLIA_CONTRACT_ADDRESS;
  console.log(
    chalk.blue(`📄 Using contract address: ${chalk.bold(contractAddress)}`)
  );

  // Get contract instance
  const CrossChainCounter = await ethers.getContractFactory(
    "CrossChainCounter"
  );
  const counter = await CrossChainCounter.attach(contractAddress);

  // Execute repayments
  console.log(chalk.yellow("\n💰 Executing batch repayments..."));
  const executeTx = await counter.executeRepayments();
  await executeTx.wait();
  console.log(chalk.green("✅ Batch repayments executed!"));
  console.log(chalk.cyan(`📝 Transaction hash: ${chalk.bold(executeTx.hash)}`));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
