require("dotenv").config();
const hre = require("hardhat");
const { ethers } = require("hardhat");
const chalk = require("chalk");
const fs = require("fs");
const path = require("path");

async function main() {
  const networkName = hre.network.name;
  const chainId = hre.network.config.chainId;

  console.log(
    chalk.blue(
      `🌐 Connected to network: ${chalk.bold(networkName)} (${chainId})`
    )
  );

  // Map network names to .env keys
  const networkToEnvKey = {
    optimismSepolia: "OPTIMISM_SEPOLIA_CONTRACT_ADDRESS",
    baseSepolia: "BASE_SEPOLIA_CONTRACT_ADDRESS",
  };

  // Deploy the CrossChainCounter contract
  console.log(chalk.yellow("\n📄 Deploying CrossChainCounter..."));
  const CrossChainCounter = await ethers.getContractFactory(
    "CrossChainCounter"
  );

  // Deploy the contract
  const contract = await CrossChainCounter.deploy();

  // Wait for deployment
  console.log(chalk.yellow("⏳ Waiting for deployment..."));
  await contract.waitForDeployment();
  const address = await contract.getAddress();

  console.log(
    chalk.green(`✅ CrossChainCounter deployed to: ${chalk.bold(address)}`)
  );

  // Wait for a few block confirmations
  console.log(chalk.yellow("\n⏳ Waiting for confirmations..."));
  const tx = await contract.deploymentTransaction();
  await tx.wait(5);
  console.log(chalk.green("🎉 Deployment confirmed!"));

  // Update .env file
  const envKey = networkToEnvKey[networkName];
  if (envKey) {
    const envPath = path.join(__dirname, "../.env");
    let envContent = "";

    // Read existing .env content if file exists
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, "utf8");
    }

    // Prepare the new entry
    const newEntry = `${envKey}=${address}`;

    // Check if the key already exists
    const envRegex = new RegExp(`^${envKey}=.*$`, "m");
    if (envContent.match(envRegex)) {
      // Update existing entry
      envContent = envContent.replace(envRegex, newEntry);
    } else {
      // Add new entry, ensuring there's a newline before it if the file isn't empty
      if (envContent && !envContent.endsWith("\n")) {
        envContent += "\n";
      }
      envContent += newEntry + "\n";
    }

    // Write updated content back to .env
    fs.writeFileSync(envPath, envContent);
    console.log(chalk.cyan(`\n📝 Updated ${envKey} in .env file`));
    console.log(chalk.yellow(`New value: ${address}`));
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
