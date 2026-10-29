import assert from "node:assert/strict";
import { test } from "node:test";
import { Interface, parseEther, MaxUint256 } from "ethers";
import { metadataHash, normalizeDetails, normalizeMetadata, parseDailyPrice, registrationIdFromReceipt } from "../src/catalogue.js";

const asset = { id: "004", name: " Camping Tent ", category: "Other", description: " Sleeps two " };

test("metadata hashing uses stable, normalized fields and preserves large integer IDs", () => {
  assert.equal(normalizeMetadata(asset).id, "4");
  assert.equal(normalizeMetadata(asset).name, "Camping Tent");
  assert.equal(metadataHash(asset), metadataHash({ ...asset, id: "4", name: "Camping Tent", ignored: "anything" }));
  assert.notEqual(metadataHash(asset), metadataHash({ ...asset, name: "Changed name" }));
  assert.equal(metadataHash(asset), metadataHash({ ...asset, id: "5" }));
  assert.equal(normalizeDetails({ ...asset, id: undefined }).name, "Camping Tent");
  assert.equal(normalizeMetadata({ ...asset, id: MaxUint256.toString() }).id, MaxUint256.toString());
});

test("the confirmed registration event supplies the ID without a next-ID prediction", () => {
  const address = "0x0000000000000000000000000000000000000001";
  const owner = "0x0000000000000000000000000000000000000002";
  const abi = new Interface(["event AssetRegistered(uint256 indexed assetId, address indexed owner, uint256 pricePerDay)"]);
  const log = abi.encodeEventLog(abi.getEvent("AssetRegistered"), [50n, owner, 1n]);
  const receipt = { logs: [{ ...log, address }] };
  assert.equal(registrationIdFromReceipt(receipt, address, abi), "50");
  assert.throws(() => registrationIdFromReceipt(receipt, owner, abi), /No registration event/);
});

test("invalid metadata is rejected before registration or persistence", () => {
  for (const change of [ { id: "1.2" }, { id: "-1" }, { id: (MaxUint256 + 1n).toString() }, { name: " " }, { name: "x".repeat(81) }, { description: "x".repeat(401) }, { category: "__proto__" } ]) {
    assert.throws(() => normalizeMetadata({ ...asset, ...change }));
  }
});

test("daily prices use integer wei and reject imprecise or overflowing values", () => {
  assert.equal(parseDailyPrice("0.002"), parseEther("0.002"));
  assert.equal(parseDailyPrice("0"), 0n);
  for (const value of ["-1", "1e2", "0.0000000000000000001", "NaN", MaxUint256.toString()]) {
    assert.throws(() => parseDailyPrice(value));
  }
});
