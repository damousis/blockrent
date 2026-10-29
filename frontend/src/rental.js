import { formatEther, ZeroAddress } from "ethers";

export function parseDuration(value) {
  if (!/^(?:[1-9]|[12][0-9]|30)$/.test(String(value))) {
    throw new Error("Choose a whole number of days from 1 to 30.");
  }
  return BigInt(value);
}

export function quote(pricePerDay, duration) {
  return pricePerDay * parseDuration(duration);
}

export function sameAddress(a, b) {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase());
}

export function rentalState(record, timestamp, wallet) {
  if (!record || sameAddress(record.owner, ZeroAddress)) {
    return { status: "unregistered", canRent: false, label: "Not listed" };
  }
  const active = BigInt(timestamp) < record.rentedUntil;
  const owns = sameAddress(wallet, record.owner);
  const renting = active && sameAddress(wallet, record.renter);
  return {
    status: active ? "rented" : "available",
    label: renting ? "Your rental" : active ? "Rented" : "Available",
    active, owns, renting,
    possessor: active ? record.renter : record.owner,
    canRent: Boolean(wallet) && !owns && !active,
  };
}

export function shortAddress(address) {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "—";
}

export function eth(value) {
  return formatEther(value);
}

export function expiryDate(timestamp) {
  return timestamp === 0n ? "Never rented" : new Date(Number(timestamp) * 1000).toLocaleString();
}

export function friendlyError(error) {
  const code = error?.code ?? error?.info?.error?.code;
  if (code === 4001 || code === "ACTION_REJECTED") return "Request cancelled in MetaMask. You can try again.";
  if (code === -32002) return "A wallet request is already open. Check MetaMask.";
  if (code === "INSUFFICIENT_FUNDS") return "This wallet needs enough test ETH for the price and transaction gas.";
  if (code === "TRANSACTION_REPLACED") return "The transaction was replaced or cancelled. Refresh to see its current state.";
  const reason = error?.reason ?? error?.info?.error?.data?.reason;
  if (reason) return reason;
  if (code === "NETWORK_ERROR" || code === "ECONNREFUSED" || code === "SERVER_ERROR") {
    return "Cannot reach the local blockchain. Check that your Hardhat node is running.";
  }
  return error?.shortMessage ?? error?.message ?? "Something went wrong. Refresh and try again.";
}
