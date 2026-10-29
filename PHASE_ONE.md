# Phase one: rental logic

**Historical guide:** The project now includes phase two. The unpaid rental
examples below describe the original phase-one version. For current calls that
include ETH, tests, and the updated demo, read [PHASE_TWO.md](PHASE_TWO.md).

This implements phase one of your proposal. The project was already initialized
with Hardhat 3, Mocha, Chai, and ethers, so running `hardhat --init` again was unnecessary.
The original Counter examples are still available.

## 1. Store each asset

Open `contracts/RentalPlatform.sol`. `Asset` holds four fields:

| Field | Example | Meaning |
| --- | --- | --- |
| `owner` | Alice's wallet | The wallet that registered the asset |
| `renter` | Bob's wallet | Most recent renter, active only before expiry |
| `rentedUntil` | Rental start + 259200 | Expiry in Unix seconds for three days |
| `pricePerDay` | 10000000000000000 | Stored price in wei: 0.01 ETH |

`assets[1]` stores the record for asset ID 1. The ID is the mapping key; it does
not need another field in the struct. Names, photos, and categories come later
in the off-chain catalogue. ID 0 and a zero price are allowed.

`balances` is included for the proposed later payment phase; it stays zero here.

## 2. Register an asset

Alice calls:

```ts
await (await platform.connect(alice).registerAsset(
  1n,
  ethers.parseEther("0.01"),
)).wait();
```

`connect(alice)` sends the transaction as Alice. Solidity sees her address as
`msg.sender`, so she becomes the recorded owner. `1n` is a JavaScript bigint,
used by ethers for Solidity integers. `wait()` waits for the transaction receipt.

An unused mapping entry has a zero owner address. Registration checks that
address before writing the record; a second registration of the same ID reverts.
Registration records a wallet's claim, not proof of real physical ownership.

## 3. Rent for whole days

Bob calls:

```ts
await (await platform.connect(bob).rentAsset(0n, 3n)).wait();
```

The contract checks that the asset exists, Bob is not its owner, its previous
rental has expired, and the duration is between 1 and 30 days inclusive.
Then it stores Bob's address and `block.timestamp + 3 * 86400` as the expiry.
One Solidity day means exactly 86,400 seconds. Fractional days are not accepted
by the integer argument. Ownership stays with Alice.

`Asset storage asset` refers to the actual mapping entry, so updating its fields
persists the new rental on-chain. A failed `require` reverts the transaction.

Phase one does not collect rent: `rentAsset` is nonpayable and rejects attached
ETH. The daily price is only stored. Transactions still consume local test gas.

## 4. Decide who has access

```ts
await platform.currentPossessor(1n);          // Bob during the rental
await platform.canUnlock(1n, bob.address);    // true
await platform.canUnlock(1n, alice.address);  // false during the rental
await platform.canUnlock(1n, charlie.address);// false
```

Both are read-only calls. `currentPossessor` returns the renter while
`block.timestamp < rentedUntil`; otherwise it returns the owner.
`canUnlock` compares that result with the supplied wallet. Unknown asset IDs
revert in all three rental/access functions, rather than authorizing a zero address.

`canUnlock` checks permission for an address. Proving that a person controls
that address requires the signature challenge planned for phase four.

## 5. Expire the rental

In tests and the demo, advance the development blockchain to the expiry:

```ts
const { rentedUntil } = await platform.assets(1n);
await networkHelpers.time.increaseTo(rentedUntil);
await platform.canUnlock(1n, bob.address);   // false
await platform.canUnlock(1n, alice.address); // true
```

Time travel is a local development feature. On a live chain the same comparison
uses normal block timestamps. No scheduled transaction clears the rental.
The historical renter remains in storage, but access reads account for expiry.
Another wallet can rent the asset again exactly at the expiry timestamp.

## 6. Run the checks and example

From the project folder in PowerShell:

```powershell
npx.cmd hardhat build
npx.cmd tsc --noEmit
npx.cmd hardhat test
npx.cmd hardhat run scripts/demo-rental.ts
```

Using `npx.cmd` avoids this machine's PowerShell restriction on `npx.ps1`.
If compiler downloads fail with a certificate error on this machine, run
`$env:NODE_OPTIONS='--use-system-ca'` in that terminal and retry. This uses
Windows' trusted certificate store while keeping certificate verification enabled.
Build before typechecking: Hardhat generates the ethers contract types from the ABI.
The demo deploys a fresh contract on an in-process local blockchain and prints
Alice, Bob, and Charlie's access before rental, during rental, and at expiry.
That temporary demo chain ends when the command finishes.

`test/RentalPlatform.ts` uses Mocha and Chai, as requested in the proposal.
Fixtures restore isolated blockchain snapshots. Tests cover registration,
duplicate IDs, unknown assets, valid/invalid duration boundaries, self-rental,
double rentals, access, exact expiry, re-rental, independent assets, and rejecting
payments. The original Counter tests also run with `hardhat test`.

## 7. Deploy separately when needed

`ignition/modules/RentalPlatform.ts` defines the deployment. To keep a local
blockchain running, start this in one terminal:

```powershell
npx.cmd hardhat node
```

In another terminal, deploy to that node:

```powershell
npx.cmd hardhat ignition deploy ignition/modules/RentalPlatform.ts --network localhost
```

The demo script deploys its own independent instance; it does not attach to this
Ignition deployment. A frontend can use the address printed by Ignition later.

Phase two adds exact ETH payments and withdrawals. The frontend, catalogue,
and chip signature simulator belong to subsequent phases.
