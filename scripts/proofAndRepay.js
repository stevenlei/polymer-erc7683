require("dotenv").config();
const { ethers } = require("ethers");
const chalk = require("chalk");
const axios = require("axios");
const readline = require("readline");

const POLYMER_API_URL = "https://proof.sepolia.polymer.zone";
const BASE_SEPOLIA_RPC = "https://sepolia.base.org";
const OPTIMISM_SEPOLIA_RPC = "https://sepolia.optimism.io";

// Contract ABI (only the functions we need)
const CONTRACT_ABI = [
  "function repayFillers(bytes calldata proof) external",
  "event FillerRepaid(bytes32 orderId, address filler)",
];

// Create readline interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// Promisify readline question
const question = (query) =>
  new Promise((resolve) => rl.question(query, resolve));

async function main() {
  // Create providers for both networks
  const baseProvider = new ethers.JsonRpcProvider(BASE_SEPOLIA_RPC);
  const optimismProvider = new ethers.JsonRpcProvider(OPTIMISM_SEPOLIA_RPC);

  // Create wallet instances for both networks
  const privateKey = process.env.PRIVATE_KEY;
  const baseWallet = new ethers.Wallet(privateKey, baseProvider);
  const optimismWallet = new ethers.Wallet(privateKey, optimismProvider);

  console.log(
    chalk.blue(`\n🔑 Using wallet address: ${chalk.bold(baseWallet.address)}`)
  );

  // Create contract instance
  const optimismContract = new ethers.Contract(
    process.env.OPTIMISM_SEPOLIA_CONTRACT_ADDRESS,
    CONTRACT_ABI,
    optimismWallet
  );

  // Get transaction hash from user input
  const txHash = await question(
    chalk.yellow(
      "\n📝 Enter the transaction hash on destination chain (Base Sepolia): "
    )
  );

  // Get transaction receipt from Base Sepolia
  const receipt = await baseProvider.getTransactionReceipt(txHash);

  if (!receipt) {
    throw new Error("❌ Transaction receipt not found on Base Sepolia");
  }

  console.log(chalk.green("\n✅ Transaction receipt found!"));
  console.log(chalk.cyan(`Block Number: ${chalk.bold(receipt.blockNumber)}`));
  console.log(chalk.cyan(`Position in Block: ${chalk.bold(receipt.index)}`));

  // Request proof from Polymer API
  console.log(chalk.yellow("\n⚡ Requesting proof from Polymer API..."));
  const proofRequest = await axios.post(
    POLYMER_API_URL,
    {
      jsonrpc: "2.0",
      id: 1,
      method: "receipt_requestProof",
      params: [
        84532, // Source chain (Base Sepolia)
        11155420, // Destination chain (Optimism Sepolia)
        receipt.blockNumber,
        receipt.index,
      ],
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.POLYMER_API_KEY}`,
      },
    }
  );

  if (proofRequest.status !== 200) {
    throw new Error(
      `❌ Failed to get proof from Polymer API. Status code: ${proofRequest.status}`
    );
  }

  const jobId = proofRequest.data.result;
  console.log(chalk.green(`✅ Proof requested. Job ID: ${chalk.bold(jobId)}`));

  // Wait for the proof to be generated
  console.log(chalk.yellow(`\n⏳ Waiting for proof to be generated...`));

  let proofResponse;
  let attempts = 0;
  const maxAttempts = 10;
  const initialDelay = 10000;
  const subsequentDelay = 5000;

  while (!proofResponse?.data?.result?.proof) {
    if (attempts >= maxAttempts) {
      throw new Error("❌ Failed to get proof after multiple attempts");
    }

    await new Promise((resolve) =>
      setTimeout(resolve, attempts === 0 ? initialDelay : subsequentDelay)
    );

    proofResponse = await axios.post(
      POLYMER_API_URL,
      {
        jsonrpc: "2.0",
        id: 1,
        method: "receipt_queryProof",
        params: [jobId],
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.POLYMER_API_KEY}`,
        },
      }
    );

    console.log(
      chalk.cyan(`>  Proof status: ${proofResponse.data.result.status}...`)
    );
    attempts++;
  }

  const proof = proofResponse.data.result.proof;
  console.log(
    chalk.green(`✅ Proof received. Length: ${chalk.bold(proof.length)} bytes`)
  );

  // Convert proof to bytes
  const proofInBytes = `0x${Buffer.from(proof, "base64").toString("hex")}`;

  // Call repayFillers with the proof on Optimism Sepolia
  console.log(
    chalk.yellow(
      "\n💰 Calling repayFillers with the proof on Optimism Sepolia..."
    )
  );

  try {
    const tx = await optimismContract.repayFillers(proofInBytes);

    const receipt = await tx.wait();

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

    console.log(chalk.green("\n✅ Transaction confirmed!"));

    // Parse FillerRepaid events
    const fillerRepaidEvents = [];
    for (const log of receipt.logs) {
      try {
        const parsed = optimismContract.interface.parseLog(log);
        if (parsed && parsed.name === "FillerRepaid") {
          fillerRepaidEvents.push({
            orderId: parsed.args[0],
            filler: parsed.args[1],
          });
        }
      } catch (e) {
        // Skip logs that aren't FillerRepaid events
        continue;
      }
    }

    if (fillerRepaidEvents.length > 0) {
      console.log(chalk.green("\n📋 Repayment Events:"));
      fillerRepaidEvents.forEach((event, index) => {
        console.log(chalk.cyan(`\nRepayment ${index + 1}:`));
        console.log(chalk.cyan(`  Order ID: ${event.orderId}`));
        console.log(chalk.cyan(`  Filler: ${event.filler}`));
      });
    } else {
      console.log(chalk.yellow("\n⚠️ No repayment events found"));
    }
  } catch (error) {
    console.error(chalk.red("\n❌ Validation failed:"), error);
    process.exit(1);
  }

  // Close readline interface
  rl.close();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(chalk.red("\n❌ Error:"), error);
    process.exit(1);
  });
