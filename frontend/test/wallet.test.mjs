import assert from "node:assert/strict";
import { test } from "node:test";
import { chooseAuthorizedAccount, requestAccountPermissions } from "../src/wallet.js";

const alice = "0x00000000000000000000000000000000000000aa";
const bob = "0x00000000000000000000000000000000000000bb";

test("keeps an explicitly chosen authorized account even when it is not first", () => {
  assert.equal(chooseAuthorizedAccount([alice, bob], bob.toUpperCase()), bob);
});

test("revoked accounts fall back to a currently authorized account", () => {
  assert.equal(chooseAuthorizedAccount([alice], bob), alice);
  assert.equal(chooseAuthorizedAccount([], bob), null);
});

test("account management requests MetaMask permissions again and propagates cancellation", async () => {
  await requestAccountPermissions({
    async request(request) {
      assert.deepEqual(request, { method: "wallet_requestPermissions", params: [{ eth_accounts: {} }] });
    },
  });
  await assert.rejects(() => requestAccountPermissions({
    async request() { throw Object.assign(new Error("Cancelled"), { code: 4001 }); },
  }), { code: 4001 });
});
