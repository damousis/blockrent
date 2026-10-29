# BlockRent

Backend security review, OWASP 2026 mapping, implemented controls and outstanding
risks are documented in [the risk assessment and treatment plan](docs/security/RISK_ASSESSMENT.md).
Run `npm.cmd run test:security` for the API/storage security checks.

Users can now register assets from the website and remove their own expired or
unrented listings. The contract assigns unique asset IDs automatically.
Read [asset registration and removal](ASSET_MANAGEMENT.md) for
examples, shared catalogue storage, and notes about older deployments.

Phases one, two, and three are implemented: asset registration, paid rentals,
owner withdrawals, and a local Vite + ethers website with MetaMask.

Read [phase three: the website and MetaMask](PHASE_THREE.md) for startup commands,
the Alice/Bob walkthrough, and explanations of each file.
The [phase-two guide](PHASE_TWO.md) covers payments and withdrawals, and the
[phase-one guide](PHASE_ONE.md) covers the original access logic.

Start the blockchain in one terminal with `npm.cmd run node:local`. Keep it running.
In another terminal:

```powershell
npm.cmd run setup:demo
npm.cmd run dev
```

Open **http://127.0.0.1:5173** in the browser with MetaMask. The demo setup seeds
three fixed assets and writes the contract address automatically. Use local
Hardhat test wallets; Alice owns the assets and Bob can rent them.

Verification:

```powershell
npx.cmd hardhat build
npx.cmd tsc --noEmit
npx.cmd hardhat test
npm.cmd run test:frontend
npm.cmd run test:browser
npm.cmd run build:frontend
```

The original starter examples and their instructions are retained below.

# Sample Hardhat 3 Project (`mocha` and `ethers`)

This project showcases a Hardhat 3 project using `mocha` for tests and the `ethers` library for Ethereum interactions.

To learn more about Hardhat 3, please visit the [Getting Started guide](https://hardhat.org/docs/getting-started#getting-started-with-hardhat-3). To share your feedback, join our [Hardhat 3](https://hardhat.org/hardhat3-telegram-group) Telegram group or [open an issue](https://github.com/NomicFoundation/hardhat/issues/new) in our GitHub issue tracker.

## Project Overview

This example project includes:

- A simple Hardhat configuration file.
- Foundry-compatible Solidity unit tests.
- TypeScript integration tests using `mocha` and ethers.js
- Examples demonstrating how to connect to different types of networks, including locally simulating OP mainnet.

## Usage

### Running Tests

To run all the tests in the project, execute the following command:

```shell
npx hardhat test
```

You can also selectively run the Solidity or `mocha` tests:

```shell
npx hardhat test solidity
npx hardhat test mocha
```

### Make a deployment to Sepolia

This project includes an example Ignition module to deploy the contract. You can deploy this module to a locally simulated chain or to Sepolia.

To run the deployment to a local chain:

```shell
npx hardhat ignition deploy ignition/modules/Counter.ts
```

To run the deployment to Sepolia, you need an account with funds to send the transaction. The provided Hardhat configuration includes a Configuration Variable called `SEPOLIA_PRIVATE_KEY`, which you can use to set the private key of the account you want to use.

You can set the `SEPOLIA_PRIVATE_KEY` variable using the `hardhat-keystore` plugin or by setting it as an environment variable.

To set the `SEPOLIA_PRIVATE_KEY` config variable using `hardhat-keystore`:

```shell
npx hardhat keystore set SEPOLIA_PRIVATE_KEY
```

After setting the variable, you can run the deployment with the Sepolia network:

```shell
npx hardhat ignition deploy --network sepolia ignition/modules/Counter.ts
```
