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

  // Get the batch hash first
  console.log(chalk.yellow("\n🔍 Getting batch hash..."));
  const batchHash = await counter.generateRepaymentBatchHash();
  
  if (batchHash === "0x0000000000000000000000000000000000000000000000000000000000000000") {
    console.log(chalk.red("\n❌ No pending repayments found!"));
    return;
  }
  
  console.log(chalk.green(`\n✅ Batch hash generated: ${chalk.bold(batchHash)}`));

  // Execute repayments
  console.log(chalk.yellow("\n💰 Executing batch repayments..."));
  const executeTx = await counter.executeRepayments();
  const receipt = await executeTx.wait();
  const tx = await executeTx.getTransaction(); // Get the full transaction to access gas limit

  // Calculate gas costs
  const gasUsed = BigInt(receipt.gasUsed);
  const gasLimit = BigInt(tx.gasLimit);
  const gasPrice = BigInt(receipt.gasPrice);

  const totalCost = gasUsed * gasPrice;
  const gasPriceInEth = ethers.formatEther(gasPrice.toString());
  const totalCostInEth = ethers.formatEther(totalCost.toString());

  // Calculate gas usage percentage against limit
  const gasPercentage = Number((gasUsed * 10000n) / gasLimit) / 100; // For 2 decimal places

  // Create a table for gas breakdown
  console.log(chalk.blue("\n📊 Transaction Details:"));

  console.log(chalk.cyan("\nTransaction Fee:"));
  console.log(`>  ${chalk.bold(totalCostInEth)} ETH`);

  console.log(chalk.cyan("\nGas Price:"));
  console.log(`>  ${chalk.bold(gasPriceInEth)} ETH`);
  console.log(`>  (${chalk.bold((Number(gasPrice) / 1e9).toFixed(9))} Gwei)`);

  console.log(chalk.cyan("\nGas Usage & Limit:"));
  console.log(
    `>  ${gasUsed.toLocaleString()} / ${gasLimit.toLocaleString()} (${gasPercentage.toFixed(
      2
    )}%)`
  );

  // Add block and status info
  console.log(chalk.cyan("\nBlock Info:"));
  console.log(`>  Block Number: ${chalk.bold(receipt.blockNumber)}`);
  console.log(`>  Transaction Hash: ${chalk.bold(receipt.hash)}`);

  console.log(chalk.green("\n✅ Batch repayments executed!"));
  console.log(chalk.cyan(`📝 Transaction hash: ${chalk.bold(executeTx.hash)}`));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
