# Registering and removing assets

Open http://127.0.0.1:5173 with the Hardhat node and website running.
Connect a test wallet using the wallet picker.

## Register an asset

1. Click **Register an asset +** above the cards.
2. Enter a name, category, description, and daily price in ETH. There is no ID field.
3. Click **Register asset** and approve the transaction in MetaMask.
4. Wait for confirmation. The new card appears and can be rented by another wallet.

Example: Bob registers **Camping Tent**, category **Other**, price
**0.002 ETH/day**. The contract assigns its ID automatically, such as **4** after
the three demo assets. Charlie can rent it for three days for **0.006 ETH** plus gas.
Bob owns the tent and can withdraw its rental earnings.

Any connected wallet can register. Prices can be zero for a free rental.
Categories select an included illustration; image uploads are not part of this feature.
Names and descriptions are displayed as plain text, not HTML.

If you cancel the transaction, no asset is registered. If the transaction succeeds
but saving the description fails, the form stays open. Submit the same form again
to finish saving; it will not charge for a second registration. A fallback card
also provides **Finish listing details** for the owner. The browser saves a local
draft to help retry; if you cleared it, you must re-enter the same original details.

## Remove an asset

1. Select the asset owner's wallet.
2. Click **Remove asset** on that asset's card.
3. Confirm removal in the dialog, then approve the transaction in MetaMask.
4. After confirmation, the card disappears for everyone using this local server.

An owner cannot remove an asset during an active rental. The contract enforces
this even if somebody bypasses the website. Removal becomes available at the
exact expiry timestamp. Other wallets cannot remove the owner's asset.

Removal does not erase or refund earned rent. Earnings remain in `balances[owner]`
and can be withdrawn normally, including after the owner's last asset is removed.
The ID stays reserved permanently. For example, after removing ID 4, the next
registration receives ID 5 automatically. Setup does not recreate removed demo assets.

The counter is stored in Solidity, so users cannot collide by choosing the same
ID. If two users register together, the blockchain processes their transactions
in order and assigns a different ID to each. The website reads the actual ID
from the confirmed `AssetRegistered` event; it never predicts or reserves an ID
in the browser. Cancelled or reverted registrations do not consume an ID.

Blockchain event history and historical metadata remain available; removing a
listing does not erase previous transactions.

## Where data lives

The contract stores ownership, price, rentals, an index of current asset IDs,
and a small hash that identifies each user-created listing's exact description.
`registerAssetWithMetadata(pricePerDay, metadataHash)` writes that hash in the same transaction as registration,
so no additional signature request is needed to publish the description.
The description hash excludes the ID because the ID is assigned during mining.
After confirmation, the description is published using the ID from that receipt.
The simpler `registerAsset(pricePerDay)` method also assigns its ID automatically.

The included local API saves descriptions in `frontend/data/catalogue.json`.
It verifies that the description's hash matches the contract before accepting it.
This prevents a different browser from publishing fake details for an asset.
The page also verifies the hash when displaying saved details.

The JSON file is shared by wallets and browsers connecting to this Vite server,
and survives website restarts. It is a local demo store, not a production database
or distributed storage. It is ignored by Git, and records are scoped by deployment.
Keep the file if you want to retain descriptions. Restarting Hardhat still resets
the blockchain, even when the descriptions remain on disk.

`assets.js` now provides only the initial three demo descriptions. The page reads
`getAssetIds()` from the chain to discover all active registrations. Removed IDs
are omitted, while newly registered IDs appear without changing frontend code.

Both `npm.cmd run dev` and `npm.cmd run preview` include the local catalogue API.
Serving `frontend/dist` from a generic static server alone does not provide this
API; a production deployment would need an appropriate backend or storage service.

## Run or update the local project

Keep your existing Hardhat node running, or start one in its own terminal:

```powershell
npm.cmd run node:local
```

In another terminal:

```powershell
npm.cmd run setup:demo
npm.cmd run dev
```

If the website already runs, setup updates its configuration and Vite reloads it.
This contract version adds removal and enumeration. A previous deployed version
cannot gain those methods, so setup deploys a new compatible instance when needed.
This starts a new set of demo listings. It does not migrate previous rentals or credits.

The previous address is saved in `frontend/data/legacy-deployments.json`. Its
existing earnings remain on that previous contract. To collect old earnings on
the same running node, open:

```powershell
npx.cmd hardhat console --network localhost
```

Then, using your previous address and the appropriate local owner signer:

```js
const { ethers } = await network.create();
const old = await ethers.getContractAt("RentalPlatform", "YOUR_PREVIOUS_ADDRESS");
const [alice, bob] = await ethers.getSigners();
await old.balances(alice.address); // Check before withdrawing.
await (await old.connect(alice).withdraw()).wait();
```

Use Bob's signer if the earnings belong to Bob. The `withdraw` method is the same
on both versions. Do not restart the Hardhat node before withdrawing old local
earnings if you want to retain that test state.

## Verification

```powershell
npx.cmd hardhat build
npx.cmd tsc --noEmit
npx.cmd hardhat test
npm.cmd run test:frontend
npm.cmd run test:browser
npm.cmd run build:frontend
```

The 45 contract tests include ownership checks, exact-expiry removal, bounded enumeration,
reserved IDs, concurrent registrations, arithmetic boundaries, and preserving earnings. The 25 frontend/server tests cover metadata
normalization, hashes, confirmed registration IDs, exact prices, wallet selection, rental rules, HTTP limits, and storage integrity.
Browser tests create a temporary chain and catalogue file to exercise registration,
cancelled transactions, metadata-save recovery, shared listings, active-rental
removal prevention, removal across browsers, and withdrawing after removal.

The catalogue reads at most 50 assets per page. Use Next/Previous for larger
collections. Backend security controls, operating limits and remaining risks are
documented in [the security assessment](docs/security/RISK_ASSESSMENT.md).
