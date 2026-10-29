# Phase three: a website for renting assets

**Update:** The website now supports new registrations with automatically assigned IDs and owner-only removal,
with descriptions saved in a shared local JSON catalogue. Read
[ASSET_MANAGEMENT.md](ASSET_MANAGEMENT.md) for the current listing workflow.

You can now browse assets, connect MetaMask, choose rental days, pay rent, and
withdraw earnings through a website. Solidity still decides who owns each
asset, who can use it, and how much must be paid.

## 1. Start the website

Use PowerShell in `C:\Users\alexd\Desktop\BlockRent`.

In terminal one, start the blockchain and keep it running:

```powershell
npm.cmd run node:local
```

If your node is already running on port 8545, keep using it. Do not start a second
one on the same port.

In terminal two, prepare the demo and start the website:

```powershell
npm.cmd run setup:demo
npm.cmd run dev
```

Open **http://127.0.0.1:5173** in the browser where MetaMask is installed.
Keep both terminals running while you use the app. Press Ctrl+C in the website
terminal when you want to stop it.

`setup:demo` checks for a compatible contract saved in the frontend configuration
or in the earlier `phase-two` Ignition deployment. It reuses a compatible
contract on the running node; otherwise it deploys one. Then it registers missing
catalogue IDs and saves the address for the website automatically.

It does not replace existing owners, prices, or rentals. Running it again on the
same node keeps those records. If it deploys a new contract, that instance starts
empty; older contract records and funds do not migrate.

The generated `frontend/src/deployment.json` contains the public contract address,
chain ID, RPC address, and contract code hash. It contains no private keys and is
ignored by Git because it depends on your local node. If you restart the node,
run setup again and reload the website. The page detects missing or different
contract code instead of letting you transact with a stale address.

## 2. What is in the catalogue?

`frontend/src/assets.js` is a small JavaScript array:

| Asset ID | Name | Initial daily price |
| --- | --- | --- |
| 1 | City Bicycle | 0.01 ETH |
| 2 | Toyota Corolla | 0.05 ETH |
| 3 | Cordless Drill | 0.005 ETH |

Example metadata:

```js
{
  id: 1,
  name: "City Bicycle",
  category: "Bike",
  description: "Take the scenic route...",
  image: "/images/bicycle.svg",
  dailyPriceEth: "0.01",
  attributes: { Gears: "7 speed", Size: "Medium" }
}
```

The name, description, picture, and attributes live outside the blockchain.
The ID joins that description to `assets[1]` in the contract. Local SVG
illustrations are included for all three assets.

`dailyPriceEth` is only the initial value used to register a missing asset.
The website always reads the actual price from Solidity. Changing this array
does not change an existing on-chain price.

These are the initial demo descriptions. New registrations now come from the
website form, with descriptions saved by the local catalogue API. The blockchain
provides the current asset IDs, so removed assets disappear and new ones are found
automatically. Image uploads are not included.

## 3. What does the page show?

Each card shows the picture and description from the catalogue, plus these
values from the blockchain:

- The registered owner's wallet.
- The wallet with current rental access.
- The actual daily price in ETH.
- Whether the asset is available or rented.
- The expiry date for an active rental, formatted in your browser's local timezone.

You can filter Bikes, Cars, and Tools. You can browse without connecting a
wallet, as long as the local node is running. Connecting is required for renting
and withdrawing.

The frontend reads a single block's snapshot so prices, availability, and wallet
earnings agree. It refreshes every eight seconds and after confirmed transactions.
The Refresh button lets you request an update immediately.

## 4. Connect Alice and Bob in MetaMask

Use only the test wallets printed by your local `hardhat node` terminal. The
first account is Alice, the demo owner. The second account is Bob, the renter.
Import each into MetaMask using its corresponding local test private key.
These are public development accounts: never use them for real funds.

Do not paste keys into the website or source code. Import them directly into
MetaMask. The app only requests account access and transaction approval.

Click **Connect MetaMask** on the page and approve the connection. The app asks
MetaMask to switch to the local network, or add it if needed:

| Setting | Value |
| --- | --- |
| Network name | Hardhat Local |
| RPC URL | http://127.0.0.1:8545 |
| Chain ID | 31337 |
| Currency symbol | ETH |

Click the connected address / **Switch** button to open **Choose your wallet**.
Select Bob to rent, or Alice to see and withdraw the owner's earnings. If an
account is missing, click **Choose accounts in MetaMask**, approve sharing the
imported accounts with BlockRent, and then choose one from the page's list.
The selected account is remembered across reloads while MetaMask still authorizes
it. Changing accounts directly in MetaMask also updates the page.

If Alice is selected, the rent buttons say **You own this asset**. That is
expected: all three demo assets are initially registered by Alice, and owners
cannot rent their own assets.

## 5. Bob rents the bicycle

Select Bob in the wallet picker, find City Bicycle, and enter **3** in Days.
The card displays **0.03 ETH** as the total rental price.

When you click **Rent this asset**, the frontend:

1. Checks the selected wallet and network.
2. Reads the latest daily price and availability from the contract.
3. Calculates the exact payment using integer wei, not floating-point arithmetic.
4. Requests this transaction through MetaMask:

```js
const days = 3n;
const record = await contract.assets(1);
const value = record.pricePerDay * days;
const transaction = await contract.rentAsset(1, days, { value });
await transaction.wait();
```

`{ value }` sends the rental payment. `wait()` waits for confirmation.
MetaMask also shows the transaction gas, which is separate from rent.

After confirmation, Bob sees **Your rental**, the expiry date, and his wallet
under Rental access. The bicycle cannot be rented again while that rental is active.

If Bob cancels in MetaMask, the page says the request was cancelled and lets him
try again. It does not claim that a rental succeeded before confirmation.

Buttons are disabled while a wallet action is in progress to prevent accidental
repeat submissions. Solidity still performs its own checks if another wallet
rents an asset before Bob's transaction reaches the chain.

## 6. Alice withdraws

Choose Alice in the wallet picker. The earnings section shows **0.03 ETH** available
after Bob's three-day bicycle rental. Click **Withdraw earnings**, then confirm
in MetaMask.

The frontend sends:

```js
const transaction = await contract.withdraw();
await transaction.wait();
```

After confirmation, Alice's credit becomes zero and the withdraw button is
disabled. Alice receives the rent in her wallet and pays withdrawal gas
separately. Bob keeps rental access until expiry.

## 7. Files and their jobs

| File | Job |
| --- | --- |
| `frontend/index.html` | Page structure, asset-card template, and wallet controls |
| `frontend/src/style.css` | Desktop and mobile layout |
| `frontend/src/assets.js` | Fixed off-chain catalogue |
| `frontend/src/config.js` | Reads generated local deployment settings with a setup fallback |
| `frontend/src/contract.js` | Ethers connections, contract ABI, chain checks, and blockchain reads |
| `frontend/src/rental.js` | Exact quotes, input validation, rental states, dates, and error messages |
| `frontend/src/wallet.js` | Chooses an authorized account and requests MetaMask account-sharing permissions |
| `frontend/src/main.js` | Renders cards and handles connection, renting, withdrawals, and refreshes |
| `frontend/public/images/` | Local asset illustrations |
| `scripts/setup-demo.ts` | Finds/deploys the contract, seeds missing assets, and configures the page |

An ABI is the list of contract methods ethers needs to call. The frontend uses
a short human-readable ABI containing only `assets`, `balances`, `rentAsset`,
and `withdraw`.

No Solidity changes were needed for phase three. We connected a website to the
phase-two contract. The chip challenge and signature verification remain phase four.

## 8. Verification commands

```powershell
npx.cmd hardhat build
npx.cmd tsc --noEmit
npx.cmd hardhat test
npm.cmd run test:frontend
npm.cmd run test:browser
npm.cmd run build:frontend
```

The frontend/server tests check exact prices, invalid durations, rental
expiry, address matching, disconnected wallets, dates, readable errors, preferred
account selection, revoked permissions, cancelled account-sharing requests,
metadata commitments, confirmed registration IDs, and listing validation.

The browser check launches installed Chrome or Edge headlessly, starts its own
temporary chain and web server, and uses a simulated EIP-1193 wallet. It verifies
real browser-to-EVM rental payments and withdrawals, wallet rejection, account
and network changes, expiry, filters, missing MetaMask, and mobile width.
It closes its test servers afterward and does not change your running demo node.
Screenshots are saved to `cache/phase-three-desktop.png` and `cache/phase-three-mobile.png`.

This automation does not approve real MetaMask extension popups. Follow the
Alice/Bob steps above to try that part yourself. On other computers, set
`BROWSER_EXECUTABLE` to an installed Chrome/Edge executable if automatic discovery fails.

`build:frontend` creates `frontend/dist`. To preview that build, run
`npm.cmd run preview` and open http://127.0.0.1:4173. Your local blockchain still
needs to be running. Run setup before building so the build includes the correct
deployment settings; rebuild if those settings change.

## 9. Common situations

| What you see | What to do |
| --- | --- |
| Local blockchain unavailable | Start `npx.cmd hardhat node`, run setup, and reload |
| Demo is not set up yet | Run `npm.cmd run setup:demo` |
| Contract missing or changed | Run setup again on the current node, then reload |
| Install and unlock MetaMask | Enable the extension in this browser, unlock it, and reload |
| Switch wallet network | Click the network switch button and approve in MetaMask |
| You own this asset | Select Bob, not Alice, to rent |
| No earnings to withdraw | Select Alice after a paid rental, or earn more rent |
| Not listed | The catalogue ID is not registered; run setup |
| Insufficient funds | Use a funded account from the currently running local node |

Stopping/restarting Hardhat resets its local blockchain state. MetaMask may
retain pending transactions from the old node; clear those local test-account
activity records if it reports stale nonces, then reconnect and retry.

If a compiler download fails because of this computer's certificate setup, use
`$env:NODE_OPTIONS='--use-system-ca'` in that terminal and retry. PowerShell
commands use `.cmd` to avoid the machine's script execution-policy restriction.
