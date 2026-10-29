import assert from "node:assert/strict";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.create();
const [alice, bob, charlie] = await ethers.getSigners();
const platform = await ethers.deployContract("RentalPlatform");
await platform.waitForDeployment();

console.log("RentalPlatform:", await platform.getAddress());
console.log("Alice (owner):", alice.address);
console.log("Bob (renter):", bob.address);
console.log("Charlie (bystander):", charlie.address);

await (await platform.connect(alice).registerAsset(ethers.parseEther("0.01"))).wait();
console.log("\n1. Alice registers Bicycle #1. Owner can unlock:", await platform.canUnlock(1n, alice.address));

const { pricePerDay } = await platform.assets(1n);
const totalPrice = pricePerDay * 3n;
await (await platform.connect(bob).rentAsset(1n, 3n, { value: totalPrice })).wait();
console.log("\n2. Bob rents for 3 days and pays", ethers.formatEther(totalPrice), "ETH.");
console.log("Alice's withdrawable earnings:", ethers.formatEther(await platform.balances(alice.address)), "ETH");
console.log("Bob can unlock:", await platform.canUnlock(1n, bob.address));
console.log("Alice can unlock:", await platform.canUnlock(1n, alice.address));
console.log("Charlie can unlock:", await platform.canUnlock(1n, charlie.address));

const { rentedUntil } = await platform.assets(1n);
await networkHelpers.time.increaseTo(rentedUntil);
console.log("\n3. Advance local blockchain time to expiry.");
console.log("Bob can unlock:", await platform.canUnlock(1n, bob.address));
console.log("Alice can unlock:", await platform.canUnlock(1n, alice.address));
console.log("Recorded owner:", (await platform.assets(1n)).owner);

await (await platform.connect(alice).withdraw()).wait();
console.log("\n4. Alice withdraws her earnings.");
console.log("Alice's remaining credit:", ethers.formatEther(await platform.balances(alice.address)), "ETH");
console.log("Contract ETH remaining:", ethers.formatEther(await ethers.provider.getBalance(await platform.getAddress())));

// A read-only simulation demonstrates the failed repeat without sending a transaction.
await assert.rejects(
  () => platform.connect(alice).withdraw.staticCall(),
  /No balance to withdraw/,
);
console.log("5. A second withdrawal is rejected: No balance to withdraw");
