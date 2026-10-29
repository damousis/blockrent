# Phase two: pay rent and withdraw earnings

The project now also includes automatic asset IDs and website registration.
Read [ASSET_MANAGEMENT.md](ASSET_MANAGEMENT.md) for the current registration API.

The contract now accepts ETH when somebody rents an asset. It keeps that ETH
until the asset's owner withdraws it. The registration and access rules from
phase one still apply.

## 1. Allow the rental function to receive ETH

In `contracts/RentalPlatform.sol`, the function is now:

```solidity
function rentAsset(uint256 assetId, uint256 durationDays) external payable
```

`payable` means the transaction can include ETH. `msg.value` is the amount
sent with that transaction, measured in wei. One ETH is 10^18 wei.
The caller still pays transaction gas separately.

## 2. Calculate the exact price

After checking the asset, availability, and duration, the contract runs:

```solidity
uint256 totalPrice = asset.pricePerDay * durationDays;
require(msg.value == totalPrice, "Incorrect payment");
```

Example: Alice lists her bicycle at 0.01 ETH per day. Bob rents for three days.

| Payment Bob sends | Result |
| --- | --- |
| 0.03 ETH | Rental succeeds |
| 0 ETH or 0.02 ETH | Rejected: too little |
| 0.04 ETH | Rejected: too much |

The comparison is exact, down to one wei. A rejected transaction does not keep
the rental payment or change the rental record. A failed transaction that is
mined can still cost gas.

## 3. Record the rental and Alice's earnings

After the payment check, the contract stores Bob's address and the expiry, then:

```solidity
balances[asset.owner] += msg.value;
```

After Bob's three-day rental:

- The contract holds 0.03 ETH.
- `balances[alice.address]` is 0.03 ETH, written as an integer in wei.
- Alice's wallet has not received that rent yet.
- Bob has access until expiry, while Alice remains the owner.

`balances` is a record of what each owner can collect. It is different from a
wallet's actual ETH balance. Earnings from multiple rentals add together.
Each owner has their own credit.

Owners can withdraw as soon as payment is recorded, even during the rental.
This phase does not add deposits, refunds, or a payment hold until expiry.

## 4. Let Alice withdraw her earnings

The new `withdraw()` function follows three steps:

```solidity
uint256 amount = balances[msg.sender];
require(amount > 0, "No balance to withdraw");

balances[msg.sender] = 0;
(bool success, ) = payable(msg.sender).call{value: amount}("");
require(success, "Withdrawal failed");
```

First, check how much the caller has earned. Then clear that credit. Finally,
send the ETH to that caller's wallet. Alice can only collect her own earnings;
there is no parameter that lets Bob select Alice's balance.

Why clear the credit before sending ETH? Receiving ETH can trigger code when
the recipient is another contract. If that code calls `withdraw()` again, the
old credit is already zero, so it cannot be collected twice. This order is
called checks-effects-interactions: check, update your records, then send.

If the recipient rejects ETH, `require(success, ...)` reverts the whole
withdrawal, including the step that set the credit to zero. The money stays in
the contract and the owner's credit is restored for a later attempt.

After a successful withdrawal, a `Withdrawal(owner, amount)` event records it.
Alice's credit is zero and a second withdrawal fails. If she earns more rent
later, she can withdraw those new earnings. Withdrawing does not affect access.

## 5. Example TypeScript calls

These snippets assume `platform` is the deployed RentalPlatform contract and
`alice` and `bob` are test signers, as in `scripts/demo-rental.ts`.

Alice registers Bicycle #1:

```ts
await (await platform.connect(alice).registerAsset(
  ethers.parseEther("0.01"),
)).wait();
```

Bob reads the price from the contract and pays for three days:

```ts
const durationDays = 3n;
const asset = await platform.assets(1n);
const totalPrice = asset.pricePerDay * durationDays;

await (await platform.connect(bob).rentAsset(
  1n,
  durationDays,
  { value: totalPrice },
)).wait();
```

`{ value: totalPrice }` attaches ETH to the transaction. It is not a third
Solidity argument. `3n` is a JavaScript bigint, which avoids rounding errors
when working with large integer amounts. Always calculate wei using bigint.

Read Alice's credit in a readable format:

```ts
const earned = await platform.balances(alice.address);
console.log(ethers.formatEther(earned)); // "0.03"
```

Alice collects it:

```ts
await (await platform.connect(alice).withdraw()).wait();
console.log(await platform.balances(alice.address)); // 0n
```

Alice's wallet receives 0.03 ETH, and Alice separately pays gas for her
withdrawal transaction. `wait()` waits for the transaction to be confirmed.

`rentedUntil` stays a Unix timestamp in the contract. For a JavaScript date:

```ts
const { rentedUntil } = await platform.assets(1n);
const expiryDate = new Date(Number(rentedUntil) * 1000);
console.log(expiryDate.toLocaleString());
```

## 6. Run the working demo

From the project folder in PowerShell:

```powershell
npx.cmd hardhat build
npx.cmd tsc --noEmit
npx.cmd hardhat test
npx.cmd hardhat run scripts/demo-rental.ts
```

The demo deploys a fresh contract on a temporary local blockchain. It uses
Hardhat test accounts and simulated ETH. It does not need MetaMask yet.

The important output is:

```text
Bob rents for 3 days and pays 0.03 ETH.
Alice's withdrawable earnings: 0.03 ETH
Bob can unlock: true
Alice can unlock: false
Charlie can unlock: false

Advance local blockchain time to expiry.
Bob can unlock: false
Alice can unlock: true

Alice withdraws her earnings.
Alice's remaining credit: 0.0 ETH
Contract ETH remaining: 0.0
A second withdrawal is rejected: No balance to withdraw
```

The last check simulates a second withdrawal without sending a transaction.
Tests also send withdrawal calls and check that repeated withdrawals revert.

If this machine reports a compiler certificate error, run
`$env:NODE_OPTIONS='--use-system-ca'` in the same terminal and retry. This uses
Windows' trusted certificates with certificate verification enabled.

## 7. What changed and what the tests prove

| File | Purpose |
| --- | --- |
| `contracts/RentalPlatform.sol` | Exact payments, owner credits, withdrawals, and withdrawal event |
| `test/RentalPlatform.ts` | Updated access tests to pay rent; added payment and withdrawal scenarios |
| `contracts/RentalPlatform.t.sol` | Tests failed transfers and attempts to withdraw twice during an ETH callback |
| `scripts/demo-rental.ts` | Shows registration, payment, access, expiry, withdrawal, and repeat rejection |

The full suite has 33 passing tests, including the starter Counter tests.
Payment tests check exact amounts, missing/insufficient/excess payments,
unchanged records after rejected payments, separate owner balances,
accumulated earnings, withdrawals, repeat prevention, and new earnings after
withdrawal. Zero-priced assets are still supported and require zero payment.

The Solidity tests use a test-only recipient contract to reject ETH or attempt
a second withdrawal during the first. That helper is not part of the application
deployment: the Ignition module still deploys only `RentalPlatform`.

Existing phase-one deployments retain their old code. Deploy this updated
contract to a fresh local development chain to use phase two. The existing
`ignition/modules/RentalPlatform.ts` deployment module still works.

The frontend and MetaMask integration are phase three.
