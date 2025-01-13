require("dotenv").config();
const hre = require("hardhat");
const { ethers } = require("hardhat");
const chalk = require("chalk");

async function checkCounter(chainName, chainId, contractAddress) {
  // Create provider for the chain
  const provider = new ethers.JsonRpcProvider(process.env[`${chainName.toUpperCase()}_RPC`]);
  
  // Get contract instance
  const CrossChainCounter = await ethers.getContractFactory("CrossChainCounter");
  const counter = CrossChainCounter.attach(contractAddress);
  
  // Connect contract to the correct provider
  const connectedCounter = counter.connect(provider);

  // Get counter value
  const value = await connectedCounter.counter();
  
  console.log(chalk.blue(`\n📊 ${chainName} Counter:`));
  console.log(chalk.cyan(`>  Chain ID: ${chalk.bold(chainId)}`));
  console.log(chalk.cyan(`>  Contract: ${chalk.bold(contractAddress)}`));
  console.log(chalk.cyan(`>  Value: ${chalk.bold(value)}`));
}

async function main() {
  console.log(chalk.yellow("🔍 Checking counter values across chains..."));

  // Check Optimism Sepolia
  await checkCounter(
    "optimism_sepolia",
    11155420,
    process.env.OPTIMISM_SEPOLIA_CONTRACT_ADDRESS
  );

  // Check Base Sepolia
  await checkCounter(
    "base_sepolia",
    84532,
    process.env.BASE_SEPOLIA_CONTRACT_ADDRESS
  );
}

// Run the script
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(chalk.red("❌ Error:"), error);
    process.exit(1);
  });
