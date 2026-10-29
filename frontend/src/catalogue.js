import { MaxUint256, id as hashText, parseEther } from "ethers";

export const categoryImages = {
  Bike: "/images/bicycle.svg", Car: "/images/car.svg",
  Tool: "/images/drill.svg", Other: "/images/asset.svg",
};

export function normalizeDetails(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Asset details must be a JSON object.");
  if (typeof input.name !== "string" || (input.description !== undefined && typeof input.description !== "string") || typeof input.category !== "string") {
    throw new Error("Name, description, and category must be text.");
  }
  const name = input.name.trim();
  const description = (input.description ?? "").trim();
  if (!name || name.length > 80) throw new Error("Give the asset a name of 1–80 characters.");
  if (description.length > 400) throw new Error("Keep the description within 400 characters.");
  if (!Object.hasOwn(categoryImages, input.category)) throw new Error("Choose a valid asset category.");
  return {
    name, category: input.category, description,
    image: categoryImages[input.category],
  };
}

export function normalizeMetadata(input) {
  const details = normalizeDetails(input);
  if (typeof input.id !== "string" && !(typeof input.id === "number" && Number.isSafeInteger(input.id))) throw new Error("A confirmed asset ID is required to publish details.");
  const rawId = String(input.id).trim();
  if (!/^\d{1,78}$/.test(rawId) || BigInt(rawId) < 1n || BigInt(rawId) > MaxUint256) throw new Error("A confirmed asset ID is required to publish details.");
  return { id: BigInt(rawId).toString(), ...details };
}

export function metadataHash(input) {
  // The ID is unknown until mining, so commit only to the description fields.
  return hashText(JSON.stringify(normalizeDetails(input)));
}

export function registrationIdFromReceipt(receipt, address, contractInterface) {
  for (const log of receipt?.logs ?? []) {
    if (log.address.toLowerCase() !== address.toLowerCase()) continue;
    try {
      const event = contractInterface.parseLog(log);
      if (event?.name === "AssetRegistered") return event.args.assetId.toString();
    } catch { /* Other log types are not registration confirmations. */ }
  }
  throw new Error("No registration event was found in the confirmed transaction.");
}

export function parseDailyPrice(value) {
  const text = String(value).trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(text)) throw new Error("Enter an ETH price with up to 18 decimal places.");
  const price = parseEther(text);
  if (price > MaxUint256 / 30n) throw new Error("That price is too large for a 30-day rental.");
  return price;
}

export async function loadCatalogue(config, ids = []) {
  const response = await fetch(`/api/catalogue?ids=${encodeURIComponent(ids.join(","))}`, { signal: AbortSignal.timeout(5000), cache: "no-store" });
  if (!response.ok) throw new Error("Asset descriptions could not be loaded.");
  const data = await response.json();
  if (!Array.isArray(data.assets)) throw new Error("Invalid catalogue response.");
  if (data.address?.toLowerCase() !== config.address.toLowerCase() || data.chainId !== config.chainId) {
    throw new Error("The catalogue uses a different deployment. Reload after running setup.");
  }
  return data.assets;
}

export async function publishMetadata(metadata) {
  const response = await fetch("/api/catalogue", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(normalizeMetadata(metadata)), signal: AbortSignal.timeout(10000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Asset details could not be saved.");
}
