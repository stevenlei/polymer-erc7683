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
  "function repayFillers(bytes calldata proof, tuple(bytes32 orderId, address filler, bool processed)[] calldata repaymentData) external",
  "function pendingRepayments(uint256 index) external view returns (tuple(bytes32 orderId, address filler, bool processed))",
  "event FillerRepaid(bytes32 orderId, address filler)",
  "event RepaymentBatchExecuted(bytes32 indexed batchHash, uint256 indexed startIndex, uint256 indexed endIndex)",
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

  // Create contract instances for both chains
  const baseContract = new ethers.Contract(
    process.env.BASE_SEPOLIA_CONTRACT_ADDRESS,
    CONTRACT_ABI,
    baseWallet
  );

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

  // Get the RepaymentBatchExecuted event from the receipt
  console.log(chalk.yellow("\n🔍 Looking for RepaymentBatchExecuted event..."));

  const repaymentBatchExecutedEvent = receipt.logs.find((log) => {
    // Check if this log is from our contract
    if (log.address.toLowerCase() !== baseContract.target.toLowerCase()) {
      return false;
    }
    // Check if this is a RepaymentBatchExecuted event
    const eventTopic = ethers.id(
      "RepaymentBatchExecuted(bytes32,uint256,uint256)"
    );
    return log.topics[0] === eventTopic;
  });

  if (!repaymentBatchExecutedEvent) {
    throw new Error("❌ RepaymentBatchExecuted event not found in transaction");
  }

  // Get batch hash and indices from topics (they're all indexed)
  const batchHash = repaymentBatchExecutedEvent.topics[1];
  const startIndex = parseInt(repaymentBatchExecutedEvent.topics[2], 16);
  const endIndex = parseInt(repaymentBatchExecutedEvent.topics[3], 16);

  console.log(chalk.green(`✅ Found batch hash: ${chalk.bold(batchHash)}`));
  console.log(
    chalk.green(
      `✅ Batch range: ${chalk.bold(startIndex)} to ${chalk.bold(endIndex)}`
    )
  );

  // Get repayments for this specific batch
  console.log(chalk.yellow("\n🔍 Getting repayment data..."));

  let repaymentData = [];

  // Only iterate over the specific batch range
  for (let i = startIndex; i <= endIndex; i++) {
    try {
      const repayment = await baseContract["pendingRepayments(uint256)"](i);

      // Include all repayments in this batch range
      repaymentData.push({
        orderId: repayment.orderId,
        filler: repayment.filler,
        processed: repayment.processed,
      });
    } catch (e) {
      console.log(chalk.red(`Error fetching repayment at index ${i}:`, e));
      break;
    }
  }

  if (repaymentData.length === 0) {
    throw new Error(
      "No repayments found in the transaction that emitted the batch hash"
    );
  }

  console.log(
    chalk.green(`✅ Found ${repaymentData.length} repayments to process`)
  );

  // Log the repayment details
  console.log(chalk.cyan("\nRepayment Details:"));
  repaymentData.forEach((repayment, i) => {
    console.log(chalk.cyan(`\nRepayment ${i + 1}:`));
    console.log(chalk.cyan(`  Order ID: ${repayment.orderId}`));
    console.log(chalk.cyan(`  Filler: ${repayment.filler}`));
    console.log(chalk.cyan(`  Processed: ${repayment.processed}`));
  });

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

  // Process repayments on Optimism
  console.log(chalk.yellow("\n💰 Processing repayments on Optimism..."));

  try {
    // First estimate gas to get a better error message if it fails
    const gasEstimate = await optimismContract.repayFillers.estimateGas(
      proofInBytes,
      repaymentData
    );

    console.log(chalk.cyan(`Estimated gas: ${gasEstimate.toString()}`));

    const repayTx = await optimismContract.repayFillers(
      proofInBytes,
      repaymentData,
      {
        gasLimit: Math.floor(gasEstimate.toString() * 1.2), // Add 20% buffer
      }
    );

    console.log(chalk.cyan(`Transaction hash: ${repayTx.hash}`));
    console.log(chalk.yellow("Waiting for transaction confirmation..."));

    const repayReceipt = await repayTx.wait();

    // Calculate gas costs
    const gasUsed = BigInt(repayReceipt.gasUsed);
    const gasLimit = BigInt(repayTx.gasLimit);
    const gasPrice = BigInt(repayReceipt.gasPrice);

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
    console.log(`>  Block Number: ${chalk.bold(repayReceipt.blockNumber)}`);
    console.log(`>  Transaction Hash: ${chalk.bold(repayReceipt.hash)}`);

    console.log(chalk.green("\n✅ Transaction confirmed!"));

    // Parse FillerRepaid events
    const fillerRepaidEvents = [];
    for (const log of repayReceipt.logs) {
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
  } catch (error) {
    console.error(chalk.red("\n❌ Error:"), error);
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
