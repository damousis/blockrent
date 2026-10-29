import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { artifacts, network } from "hardhat";
import { assets } from "../frontend/src/assets.js";
import { metadataHash, normalizeMetadata, registrationIdFromReceipt, type AssetMetadata } from "../frontend/src/catalogue.js";
import { updateCatalogueStore } from "../frontend/server/catalogue-store.js";

const { ethers, networkConfig } = await network.create();
if (networkConfig.type !== "http") {
  throw new Error("Use --network localhost so the website and setup share the same running node.");
}
const chain = await ethers.provider.getNetwork();
if (chain.chainId !== 31337n) throw new Error("Demo setup requires the Hardhat local chain (31337).");

const artifact = await artifacts.readArtifact("RentalPlatform");
const expectedHash = ethers.keccak256(artifact.deployedBytecode);
const configFile = new URL("../frontend/src/deployment.json", import.meta.url);
type Deployment = { address: string; chainId: number; rpcUrl: string; runtimeCodeHash: string };
let previousDeployment: Deployment | undefined;
const candidates: string[] = [];
for (const file of [configFile, new URL("../ignition/deployments/phase-two/deployed_addresses.json", import.meta.url)]) {
  try {
    const saved = JSON.parse(await readFile(file, "utf8"));
    if (file === configFile && ethers.isAddress(saved.address)) previousDeployment = saved;
    const candidate = saved.address ?? saved["RentalPlatformModule#RentalPlatform"];
    if (ethers.isAddress(candidate)) candidates.push(candidate);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

let address: string | undefined;
for (const candidate of candidates) {
  const code = await ethers.provider.getCode(candidate);
  if (code !== "0x" && ethers.keccak256(code) === expectedHash) {
    address = candidate;
    break;
  }
}
if (!address) {
  const deployed = await ethers.deployContract("RentalPlatform");
  await deployed.waitForDeployment();
  address = await deployed.getAddress();
  console.log("Deployed RentalPlatform:", address);
} else {
  console.log("Reusing RentalPlatform:", address);
}

const platform = await ethers.getContractAt("RentalPlatform", address);
const [alice] = await ethers.getSigners();
console.log("Demo owner (Alice):", alice.address);
const descriptions: AssetMetadata[] = [];
for (const asset of assets) {
  const record = await platform.assets(asset.id);
  if (record.owner === ethers.ZeroAddress && !(await platform.usedAssetIds(asset.id))) {
    const transaction = await platform.connect(alice).registerAssetWithMetadata(ethers.parseEther(asset.dailyPriceEth), metadataHash(asset));
    const receipt = await transaction.wait();
    const id = registrationIdFromReceipt(receipt, address, platform.interface);
    descriptions.push(normalizeMetadata({ ...asset, id }));
    console.log(`Registered #${id}: ${asset.name}`);
  } else if (record.owner !== ethers.ZeroAddress) {
    console.log(`Keeping existing #${asset.id}: owner ${record.owner}, ${ethers.formatEther(record.pricePerDay)} ETH/day`);
  } else {
    console.log(`Keeping #${asset.id} removed; setup will not recreate it.`);
  }
}

if (descriptions.length > 0) {
  const file = new URL("../frontend/data/catalogue.json", import.meta.url);
  const scope = `${Number(chain.chainId)}:${address.toLowerCase()}:${expectedHash}`;
  await updateCatalogueStore(fileURLToPath(file), catalogue => {
    catalogue[scope] ??= {};
    for (const description of descriptions) catalogue[scope][description.id] = description;
  });
}

const previous = previousDeployment;
if (previous && (previous.address !== address || previous.runtimeCodeHash !== expectedHash)) {
  const historyFile = new URL("../frontend/data/legacy-deployments.json", import.meta.url);
  let history: Deployment[] = [];
  try { history = JSON.parse(await readFile(historyFile, "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (!history.some(entry => entry.address === previous.address && entry.runtimeCodeHash === previous.runtimeCodeHash)) {
    history.push(previous);
    await mkdir(new URL("../frontend/data/", import.meta.url), { recursive: true });
    await writeFile(historyFile, JSON.stringify(history, null, 2) + "\n");
  }
  console.log("Previous deployment preserved:", previous.address);
  console.log("Its existing rentals and earnings remain there; deployment history is in frontend/data/legacy-deployments.json.");
}

await writeFile(configFile, JSON.stringify({
  address, chainId: Number(chain.chainId), rpcUrl: "http://127.0.0.1:8545", runtimeCodeHash: expectedHash,
}, null, 2) + "\n");
console.log("Frontend configured. Run npm.cmd run dev and open http://127.0.0.1:5173");
