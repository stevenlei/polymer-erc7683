# Cross-Chain Counter with ERC7683 and Polymer

This repository demonstrates a cross-chain counter implementation using [ERC-7683](https://eips.ethereum.org/EIPS/eip-7683) and [Polymer's Prove API](https://polymerlabs.org/). It showcases how to handle cross-chain message passing with filler repayments.

## Overview

The system consists of a counter contract deployed on two chains (e.g., Optimism Sepolia and Base Sepolia). When the counter `incrementCrossChain()` function is called on one chain, it triggers a cross-chain message to increment the counter on the other chain. Fillers can help relay these messages, and they will be repaid for their service.

## Workflow

1. **Deploy Contracts**

   ```bash
   npm run deploy
   ```

   - Deploys the `CrossChainCounter` contract on both chains

2. **Relayer Setup**

   ```bash
   npm run relayer
   ```

   - Sets up the relayer (filler) and listens for the `Open` event, to fill the order on the destination chain.

3. **Cross-Chain Increment**

   ```bash
   npm run increment
   ```

   - Emits a cross-chain increment event
   - When fillers help relay this message on the destination chain, the repayment is queued on the destination chain.

4. **Execute Batch Repayments**

   ```bash
   npm run repayment
   ```

   - Executes all pending (queued) repayments on the destination chain in a single transaction
   - Emits `RepaymentExecuted` events for each filler that helped relay messages
   - Returns a transaction hash that will be used for proving these events back on the source chain

5. **Prove and Process Repayments**
   ```bash
   npm run proof
   ```
   - Uses the transaction hash from step 3 to request a proof from Polymer's Prove API
   - Submits this proof to the `repayFillers` function on the source chain
   - The contract extracts all `RepaymentExecuted` events from the proof
   - For each event, simulates the repayment by emitting a `FillerRepaid` event on the source chain

## Contract Details

The main contract `CrossChainCounter.sol` implements:

- Cross-chain message passing using ERC-7683
- Queue system for filler repayments
- Batch execution of repayments
- Proof verification and event extraction for cross-chain repayments

## Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy `.env.example` to `.env` and fill in your values:
   ```bash
   cp .env.example .env
   ```

## Configuration

The `.env` file should contain:

- Contract addresses for both chains
- RPC endpoints
- Private key for transactions
- Polymer configuration

## Development

1. Deploy contracts:

   ```bash
   npm run deploy
   ```

2. Run the relayer:

   ```bash
   npm run relayer
   ```

3. Run the full workflow:

   ```bash
   # 1. Increment counter (triggers cross-chain message)
   npm run increment

   # 2. Execute pending repayments on destination chain
   npm run repayment

   # 3. Prove and process repayments on source chain
   npm run proof
   ```

## Gas Optimization

The system is optimized for gas usage by:

- Batching multiple repayments in a single transaction
- Using efficient event extraction from proofs
- Minimizing storage operations

## Resources

- [ERC7683 Specification](https://eips.ethereum.org/EIPS/eip-7683)
- [Polymer Documentation](https://docs.polymerlabs.org)

## Disclaimer

This is a proof of concept and is not intended for production use. It may contain bugs, vulnerabilities, or other issues that make it unsuitable for use in a production environment. I am not responsible for any issues that may arise from using this project on mainnet.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
