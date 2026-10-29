import { sameAddress } from "./rental.js";

export function chooseAuthorizedAccount(accounts, preferred) {
  return accounts.find(account => sameAddress(account, preferred)) ?? accounts[0] ?? null;
}

export async function requestAccountPermissions(ethereum) {
  // Unlike eth_requestAccounts, this prompts again for an existing connection.
  await ethereum.request({
    method: "wallet_requestPermissions",
    params: [{ eth_accounts: {} }],
  });
}
