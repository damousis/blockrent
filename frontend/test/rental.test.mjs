import assert from "node:assert/strict";
import { test } from "node:test";
import { parseEther, ZeroAddress } from "ethers";
import { expiryDate, friendlyError, parseDuration, quote, rentalState } from "../src/rental.js";

const alice = "0x00000000000000000000000000000000000000aA";
const bob = "0x00000000000000000000000000000000000000bB";
const record = { owner: alice, renter: bob, rentedUntil: 1000n, pricePerDay: parseEther("0.01") };

test("rental quotes use exact bigint wei, including fractional ETH prices", () => {
  assert.equal(quote(parseEther("0.005"), "3"), parseEther("0.015"));
  assert.equal(quote(1n, "30"), 30n);
});

test("duration validation rejects fractions, exponent notation, and out-of-range days", () => {
  for (const value of ["", "0", "31", "1.5", "1e1", "-1", "Infinity", " 3 "]) {
    assert.throws(() => parseDuration(value), /whole number/);
  }
  assert.equal(parseDuration("1"), 1n);
  assert.equal(parseDuration("30"), 30n);
});

test("active rentals deny new renters and distinguish the connected renter", () => {
  const info = rentalState(record, 999, bob.toLowerCase());
  assert.equal(info.renting, true);
  assert.equal(info.label, "Your rental");
  assert.equal(info.canRent, false);
  assert.equal(info.possessor, bob);
});

test("at the exact expiry, access returns to the owner and another wallet can rent", () => {
  const info = rentalState(record, 1000, bob);
  assert.equal(info.canRent, true);
  assert.equal(info.active, false);
  assert.equal(info.possessor, alice);
  assert.equal(rentalState(record, 1000, alice.toLowerCase()).canRent, false);
});

test("missing records and disconnected wallets cannot rent", () => {
  assert.equal(rentalState(null, 0, bob).canRent, false);
  assert.equal(rentalState({ ...record, owner: ZeroAddress }, 0, bob).status, "unregistered");
  assert.equal(rentalState(record, 1000, null).canRent, false);
});

test("expiry dates convert blockchain seconds to JavaScript milliseconds", () => {
  assert.equal(expiryDate(0n), "Never rented");
  assert.equal(expiryDate(1000n), new Date(1_000_000).toLocaleString());
});

test("wallet rejection and insufficient funds have readable messages", () => {
  assert.match(friendlyError({ code: 4001 }), /cancelled/);
  assert.match(friendlyError({ code: "ACTION_REJECTED" }), /cancelled/);
  assert.match(friendlyError({ code: "INSUFFICIENT_FUNDS" }), /gas/);
  assert.equal(friendlyError({ reason: "Asset already rented" }), "Asset already rented");
});
