import { BrowserProvider, Contract, JsonRpcProvider, ZeroHash, getAddress, keccak256 } from "ethers";
import { config } from "./config.js";
import { sameAddress } from "./rental.js";
import { categoryImages, loadCatalogue, metadataHash, normalizeMetadata } from "./catalogue.js";

export { config };
// Human-readable ABI: only the methods used by this frontend.
export const rentalAbi = [
  "function assets(uint256) view returns (address owner, address renter, uint256 rentedUntil, uint256 pricePerDay)",
  "function balances(address) view returns (uint256)",
  "function rentAsset(uint256 assetId, uint256 durationDays) payable",
  "function withdraw()",
  "function getAssetIds() view returns (uint256[])",
  "function getAssetCount() view returns (uint256)",
  "function getAssetIdsPage(uint256 offset, uint256 limit) view returns (uint256[])",
  "function usedAssetIds(uint256) view returns (bool)",
  "function metadataHashes(uint256) view returns (bytes32)",
  "function registerAssetWithMetadata(uint256 pricePerDay, bytes32 metadataHash) returns (uint256)",
  "event AssetRegistered(uint256 indexed assetId, address indexed owner, uint256 pricePerDay)",
  "function removeAsset(uint256 assetId)",
];

export function createReadConnection() {
  if (!config.address || !config.runtimeCodeHash) {
    throw new Error("The demo is not set up yet. Run npm.cmd run setup:demo with your Hardhat node running.");
  }
  const provider = new JsonRpcProvider(config.rpcUrl, config.chainId, {
    staticNetwork: true, cacheTimeout: -1,
  });
  const contract = new Contract(getAddress(config.address), rentalAbi, provider);
  return { provider, contract };
}

export async function assertDeployment(provider) {
  const chainId = await provider.send("eth_chainId", []);
  if (BigInt(chainId) !== BigInt(config.chainId)) throw new Error("The RPC is connected to a different chain. Run the local demo setup again.");
  const code = await provider.getCode(config.address);
  if (code === "0x" || keccak256(code) !== config.runtimeCodeHash) {
    throw new Error("The contract is missing or changed on this node. Run npm.cmd run setup:demo again, then reload this page.");
  }
}

// Read a consistent snapshot so price, availability, credit, and time agree.
export async function readSnapshot(connection, seedCatalogue, wallet, requestedPage = 0) {
  await assertDeployment(connection.provider);
  const block = await connection.provider.getBlock("latest");
  if (!block) throw new Error("No block is available yet.");
  const overrides = { blockTag: block.number };
  let catalogueWarning = "";
  const pageSize = 50;
  const [count, balance] = await Promise.all([
    connection.contract.getAssetCount(overrides),
    wallet ? connection.contract.balances(wallet, overrides) : Promise.resolve(0n),
  ]);
  const totalCount = Number(count);
  const page = Math.max(0, Math.min(requestedPage, Math.ceil(totalCount / pageSize) - 1));
  const ids = await connection.contract.getAssetIdsPage(page * pageSize, pageSize, overrides);
  const [records, hashes, details] = await Promise.all([
    Promise.all(ids.map(id => connection.contract.assets(id, overrides))),
    Promise.all(ids.map(id => connection.contract.metadataHashes(id, overrides))),
    loadCatalogue(config, ids.map(id => id.toString())).catch(() => {
      catalogueWarning = "Some listing details could not be loaded. Blockchain records are still available.";
      return [];
    }),
  ]);
  const seeds = new Map(seedCatalogue.map(asset => [String(asset.id), asset]));
  const published = new Map(details.map(asset => [String(asset.id), asset]));
  const catalogue = ids.map((value, index) => {
    const id = value.toString();
    const saved = published.get(id);
    if (saved) {
      try {
        if (metadataHash(saved) === hashes[index]) return { ...normalizeMetadata(saved), attributes: {} };
      } catch { /* Untrusted details never replace the committed metadata. */ }
    }
    if (hashes[index] === ZeroHash && seeds.has(id)) return { ...seeds.get(id), id };
    return {
      id, name: `Asset #${id}`, category: "Other", image: categoryImages.Other,
      description: "Registered on the blockchain. The owner can finish publishing its details.",
      attributes: {}, metadataMissing: hashes[index] !== ZeroHash,
    };
  });
  return { records, catalogue, catalogueWarning, balance, page, pageSize, totalCount, timestamp: block.timestamp, blockNumber: block.number };
}

export async function ensureLocalChain(ethereum) {
  const chainId = `0x${BigInt(config.chainId).toString(16)}`;
  try {
    await ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
  } catch (error) {
    if ((error.code ?? error?.data?.originalError?.code) !== 4902) throw error;
    await ethereum.request({ method: "wallet_addEthereumChain", params: [{
      chainId, chainName: "Hardhat Local", rpcUrls: [config.rpcUrl],
      nativeCurrency: { name: "Test Ether", symbol: "ETH", decimals: 18 },
    }] });
    await ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
  }
}

export async function walletContract(ethereum, account) {
  const chain = await ethereum.request({ method: "eth_chainId" });
  if (BigInt(chain) !== BigInt(config.chainId)) throw new Error("Switch MetaMask to Hardhat Local before sending a transaction.");
  const accounts = await ethereum.request({ method: "eth_accounts" });
  if (!accounts.some(authorized => sameAddress(authorized, account))) {
    throw new Error("This wallet is no longer shared with BlockRent. Choose your wallet again.");
  }
  const provider = new BrowserProvider(ethereum);
  await assertDeployment(provider);
  const signer = await provider.getSigner(account);
  return new Contract(config.address, rentalAbi, signer);
}
