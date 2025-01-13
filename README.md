# Cross-Chain Counter with ERC7683 and Polymer

This project demonstrates a practical implementation of the ERC7683 cross-chain intents standard with a filler powered by Polymer's Prove API. It features a simple cross-chain counter contract that can be incremented across different chains, showcasing the power of cross-chain communication.

## Overview

The project consists of two main components:

1. **CrossChainCounter Contract**: A smart contract implementing the ERC7683 standard that maintains a counter which can be incremented across different chains.

2. **Polymer Relayer**: An automated relayer service that uses Polymer's Prove API to handle cross-chain message verification and execution.

## How It Works

1. A user opens a cross-chain order (intent) on the origin chain (e.g., Optimism Sepolia)
2. The relayer (filler) monitors for new cross-chain orders
3. Using Polymer's Prove API, the filler validates and generates the required proof data
4. The order is filled on the destination chain (e.g., Base Sepolia) by executing the counter increment

## Quick Start

1. Install dependencies:

```bash
npm install
```

2. Configure environment:

```bash
cp .env.example .env
# Edit .env with your private keys and RPC endpoints
```

3. Deploy contracts:

```bash
# Deploy to Optimism Sepolia
npm run deploy:optimism

# Deploy to Base Sepolia
npm run deploy:base
```

4. Run the relayer:

```bash
npm run relayer
```

5. Start the demo:

```bash
npm run start
```

6. Check the counter values across chains:

```bash
npm run check
```

## Contract Architecture

The `CrossChainCounter` contract implements two key ERC7683 interfaces:

- `IERC7683OriginSettler`: Handles the initiation of cross-chain messages
- `IERC7683DestinationSettler`: Processes incoming cross-chain messages

## Scripts

- `deploy.js`: Deploys the CrossChainCounter contract
- `relayer.js`: Runs the Polymer-powered relayer service
- `erc7683.js`: Demo script showing cross-chain counter increments
- `check-counters.js`: Utility to check counter values across chains

## Networks

Currently supported networks:

- Optimism Sepolia
- Base Sepolia

## Environment Variables

Required environment variables:

```
PRIVATE_KEY=your_private_key
OPTIMISM_SEPOLIA_RPC=optimism_rpc_url
BASE_SEPOLIA_RPC=base_rpc_url
POLYMER_API_KEY=your_polymer_api_key
```

## Resources

- [ERC7683 Specification](https://eips.ethereum.org/EIPS/eip-7683)
- [Polymer Documentation](https://docs.polymerlabs.org)

## Disclaimer

This is a proof of concept and is not intended for production use. It may contain bugs, vulnerabilities, or other issues that make it unsuitable for use in a production environment. I am not responsible for any issues that may arise from using this project on mainnet.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
