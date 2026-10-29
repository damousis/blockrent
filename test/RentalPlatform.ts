import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.create();
const DAY = 86_400n;
const PRICE = ethers.parseEther("0.01");

async function registeredAssetFixture() {
  const [alice, bob, charlie] = await ethers.getSigners();
  const platform = await ethers.deployContract("RentalPlatform");
  await platform.waitForDeployment();
  await (await platform.connect(alice).registerAsset(PRICE)).wait();
  return { platform, alice, bob, charlie };
}

async function rentedAssetFixture() {
  const fixture = await registeredAssetFixture();
  await (await fixture.platform.connect(fixture.bob).rentAsset(1n, 3n, { value: PRICE * 3n })).wait();
  const asset = await fixture.platform.assets(1n);
  return { ...fixture, expiry: asset.rentedUntil };
}

describe("RentalPlatform (phases one and two)", function () {
  it("registers an asset with its owner, price, and no rental", async function () {
    const { platform, alice } = await networkHelpers.loadFixture(registeredAssetFixture);
    expect(await platform.assets(1n)).to.deep.equal([alice.address, ethers.ZeroAddress, 0n, PRICE]);
    expect(await platform.currentPossessor(1n)).to.equal(alice.address);
    expect(await platform.canUnlock(1n, alice.address)).to.equal(true);
    await expect(platform.registerAsset(PRICE))
      .to.emit(platform, "AssetRegistered").withArgs(2n, alice.address, PRICE);
  });

  it("assigns unique IDs when two wallets register concurrently", async function () {
    const { platform, bob } = await networkHelpers.loadFixture(registeredAssetFixture);
    await Promise.all([
      platform.registerAsset(PRICE).then(transaction => transaction.wait()),
      platform.connect(bob).registerAsset(1n).then(transaction => transaction.wait()),
    ]);
    expect(await platform.getAssetIds()).to.deep.equal([1n, 2n, 3n]);
    expect(await platform.nextAssetId()).to.equal(4n);
    const owners = [(await platform.assets(2n)).owner, (await platform.assets(3n)).owner];
    expect(owners).to.include(bob.address);
  });

  it("supports a zero price while assigning IDs starting at one", async function () {
    const { platform, alice } = await networkHelpers.loadFixture(registeredAssetFixture);
    await (await platform.registerAsset(0n)).wait();
    expect(await platform.currentPossessor(2n)).to.equal(alice.address);
    expect((await platform.assets(2n)).pricePerDay).to.equal(0n);
    expect(await platform.usedAssetIds(0n)).to.equal(false);
  });

  it("rejects unknown assets in rental and access functions", async function () {
    const { platform, bob } = await networkHelpers.loadFixture(registeredAssetFixture);
    await expect(platform.connect(bob).rentAsset(99n, 1n)).to.be.revertedWith("Asset does not exist");
    await expect(platform.currentPossessor(99n)).to.be.revertedWith("Asset does not exist");
    await expect(platform.canUnlock(99n, ethers.ZeroAddress)).to.be.revertedWith("Asset does not exist");
  });

  it("records an exact expiry and emits the rental event without changing ownership", async function () {
    const { platform, alice, bob } = await networkHelpers.loadFixture(registeredAssetFixture);
    const start = BigInt(await networkHelpers.time.latest()) + 10n;
    await networkHelpers.time.setNextBlockTimestamp(start);
    await expect(platform.connect(bob).rentAsset(1n, 3n, { value: PRICE * 3n }))
      .to.emit(platform, "AssetRented").withArgs(1n, bob.address, start + 3n * DAY);
    expect(await platform.assets(1n)).to.deep.equal([alice.address, bob.address, start + 3n * DAY, PRICE]);
  });

  it("rejects an owner renting their own asset", async function () {
    const { platform } = await networkHelpers.loadFixture(registeredAssetFixture);
    await expect(platform.rentAsset(1n, 1n)).to.be.revertedWith("Owner cannot rent own asset");
  });

  for (const duration of [0n, 31n, ethers.MaxUint256]) {
    it(`rejects invalid duration ${duration}`, async function () {
      const { platform, bob } = await networkHelpers.loadFixture(registeredAssetFixture);
      await expect(platform.connect(bob).rentAsset(1n, duration)).to.be.revertedWith("Duration must be 1-30 days");
      expect((await platform.assets(1n)).renter).to.equal(ethers.ZeroAddress);
    });
  }

  for (const duration of [1n, 30n]) {
    it(`accepts the duration boundary of ${duration} days`, async function () {
      const { platform, bob } = await networkHelpers.loadFixture(registeredAssetFixture);
      await (await platform.connect(bob).rentAsset(1n, duration, { value: PRICE * duration })).wait();
      expect((await platform.assets(1n)).rentedUntil)
        .to.equal(BigInt(await networkHelpers.time.latest()) + duration * DAY);
    });
  }

  it("prevents another rental or an extension while occupied", async function () {
    const { platform, bob, charlie, expiry } = await networkHelpers.loadFixture(rentedAssetFixture);
    for (const signer of [bob, charlie]) {
      await expect(platform.connect(signer).rentAsset(1n, 1n)).to.be.revertedWith("Asset already rented");
    }
    expect((await platform.assets(1n)).rentedUntil).to.equal(expiry);
  });

  it("gives only the renter access while the rental is active", async function () {
    const { platform, alice, bob, charlie, expiry } = await networkHelpers.loadFixture(rentedAssetFixture);
    await networkHelpers.time.increaseTo(expiry - 1n);
    expect(await platform.currentPossessor(1n)).to.equal(bob.address);
    expect(await platform.canUnlock(1n, bob.address)).to.equal(true);
    for (const wallet of [alice.address, charlie.address, ethers.ZeroAddress]) {
      expect(await platform.canUnlock(1n, wallet)).to.equal(false);
    }
  });

  it("returns access to the owner exactly at expiry, without a cleanup transaction", async function () {
    const { platform, alice, bob, charlie, expiry } = await networkHelpers.loadFixture(rentedAssetFixture);
    await networkHelpers.time.increaseTo(expiry);
    expect(await platform.currentPossessor(1n)).to.equal(alice.address);
    expect(await platform.canUnlock(1n, alice.address)).to.equal(true);
    expect(await platform.canUnlock(1n, bob.address)).to.equal(false);
    expect(await platform.canUnlock(1n, charlie.address)).to.equal(false);
    // Historical renter remains stored; currentPossessor interprets expiry.
    expect((await platform.assets(1n)).renter).to.equal(bob.address);
    await networkHelpers.time.increase(DAY);
    expect(await platform.currentPossessor(1n)).to.equal(alice.address);
  });

  it("allows a new renter exactly at expiry", async function () {
    const { platform, alice, charlie, expiry } = await networkHelpers.loadFixture(rentedAssetFixture);
    await networkHelpers.time.setNextBlockTimestamp(expiry);
    await (await platform.connect(charlie).rentAsset(1n, 2n, { value: PRICE * 2n })).wait();
    expect(await platform.assets(1n)).to.deep.equal([alice.address, charlie.address, expiry + 2n * DAY, PRICE]);
    expect(await platform.currentPossessor(1n)).to.equal(charlie.address);
  });

  it("keeps different assets independent", async function () {
    const { platform, alice, bob, charlie } = await networkHelpers.loadFixture(rentedAssetFixture);
    await (await platform.connect(charlie).registerAsset(PRICE)).wait();
    await (await platform.connect(alice).rentAsset(2n, 1n, { value: PRICE })).wait();
    expect(await platform.currentPossessor(1n)).to.equal(bob.address);
    expect(await platform.currentPossessor(2n)).to.equal(alice.address);
  });

  it("holds the exact payment and credits only the asset owner", async function () {
    const { platform, alice, bob } = await networkHelpers.loadFixture(registeredAssetFixture);
    await expect(platform.connect(bob).rentAsset(1n, 3n, { value: PRICE * 3n }))
      .to.changeEtherBalances(ethers, [bob, platform], [-PRICE * 3n, PRICE * 3n]);
    expect(await platform.balances(alice.address)).to.equal(PRICE * 3n);
    expect(await platform.balances(bob.address)).to.equal(0n);
  });

  for (const value of [0n, PRICE * 3n - 1n, PRICE * 3n + 1n]) {
    it(`rejects an incorrect three-day payment of ${value} wei without changing state`, async function () {
      const { platform, alice, bob } = await networkHelpers.loadFixture(registeredAssetFixture);
      await expect(platform.connect(bob).rentAsset(1n, 3n, { value }))
        .to.be.revertedWith("Incorrect payment");
      expect(await platform.assets(1n)).to.deep.equal([alice.address, ethers.ZeroAddress, 0n, PRICE]);
      expect(await platform.balances(alice.address)).to.equal(0n);
      expect(await ethers.provider.getBalance(await platform.getAddress())).to.equal(0n);
    });
  }

  it("withdraws earnings once, even during an active rental, without changing access", async function () {
    const { platform, alice, bob } = await networkHelpers.loadFixture(rentedAssetFixture);
    const withdrawal = platform.connect(alice).withdraw();
    await expect(withdrawal).to.changeEtherBalances(ethers, [platform, alice], [-PRICE * 3n, PRICE * 3n]);
    await expect(withdrawal).to.emit(platform, "Withdrawal").withArgs(alice.address, PRICE * 3n);
    expect(await platform.balances(alice.address)).to.equal(0n);
    expect(await platform.currentPossessor(1n)).to.equal(bob.address);
    await expect(platform.connect(alice).withdraw()).to.be.revertedWith("No balance to withdraw");
  });

  it("does not let other wallets withdraw an owner's earnings", async function () {
    const { platform, alice, bob, charlie } = await networkHelpers.loadFixture(rentedAssetFixture);
    for (const signer of [bob, charlie]) {
      await expect(platform.connect(signer).withdraw()).to.be.revertedWith("No balance to withdraw");
    }
    expect(await platform.balances(alice.address)).to.equal(PRICE * 3n);
  });

  it("accumulates earnings across rentals and keeps each owner's funds separate", async function () {
    const { platform, alice, bob, charlie, expiry } = await networkHelpers.loadFixture(rentedAssetFixture);
    await (await platform.connect(charlie).registerAsset(PRICE)).wait();
    await (await platform.connect(bob).rentAsset(2n, 1n, { value: PRICE })).wait();
    await networkHelpers.time.increaseTo(expiry);
    await (await platform.connect(bob).rentAsset(1n, 2n, { value: PRICE * 2n })).wait();
    expect(await platform.balances(alice.address)).to.equal(PRICE * 5n);
    expect(await platform.balances(charlie.address)).to.equal(PRICE);
    await (await platform.connect(alice).withdraw()).wait();
    expect(await ethers.provider.getBalance(await platform.getAddress())).to.equal(PRICE);
    expect(await platform.balances(charlie.address)).to.equal(PRICE);
    await (await platform.connect(charlie).withdraw()).wait();
    expect(await ethers.provider.getBalance(await platform.getAddress())).to.equal(0n);
  });

  it("allows a new withdrawal after earning more rent", async function () {
    const { platform, alice, bob, expiry } = await networkHelpers.loadFixture(rentedAssetFixture);
    await (await platform.connect(alice).withdraw()).wait();
    await networkHelpers.time.increaseTo(expiry);
    await (await platform.connect(bob).rentAsset(1n, 1n, { value: PRICE })).wait();
    await expect(platform.connect(alice).withdraw())
      .to.changeEtherBalances(ethers, [platform, alice], [-PRICE, PRICE]);
    expect(await platform.balances(alice.address)).to.equal(0n);
  });

  it("still allows a zero-priced asset to be rented for zero ETH", async function () {
    const { platform, alice, bob } = await networkHelpers.loadFixture(registeredAssetFixture);
    await (await platform.registerAsset(0n)).wait();
    await (await platform.connect(bob).rentAsset(2n, 1n)).wait();
    expect(await platform.currentPossessor(2n)).to.equal(bob.address);
    expect(await platform.balances(alice.address)).to.equal(0n);
  });

  it("does not keep payment sent for an unavailable asset", async function () {
    const { platform, alice, charlie } = await networkHelpers.loadFixture(rentedAssetFixture);
    await expect(platform.connect(charlie).rentAsset(1n, 1n, { value: PRICE }))
      .to.be.revertedWith("Asset already rented");
    expect(await platform.balances(alice.address)).to.equal(PRICE * 3n);
    expect(await ethers.provider.getBalance(await platform.getAddress())).to.equal(PRICE * 3n);
  });
});
