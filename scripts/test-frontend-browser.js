import assert from "node:assert/strict";
import { access, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { artifacts, network } from "hardhat";
import { ContractFactory, JsonRpcProvider, keccak256, parseEther } from "ethers";
import { chromium } from "playwright-core";
import { createServer as createViteServer } from "vite";
import { assets } from "../frontend/src/assets.js";
import { createCataloguePlugin } from "../frontend/server/catalogue.js";
import { localServerSecurity } from "../frontend/server/server-config.js";

// Run against a separate throwaway EVM. Never reset or rent assets on the user's node.
const chainServer = await network.createServer("hardhatMainnet", "127.0.0.1", 0);
let browser;
let appServer;
let provider;
try {
  const { port } = await chainServer.listen();
  const rpcUrl = `http://127.0.0.1:${port}`;
  provider = new JsonRpcProvider(rpcUrl, undefined, { cacheTimeout: -1 });
  const alice = await provider.getSigner(0);
  const bob = await provider.getSigner(1);
  const charlie = await provider.getSigner(2);
  const addresses = await Promise.all([alice, bob, charlie].map(signer => signer.getAddress()));
  const artifact = await artifacts.readArtifact("RentalPlatform");
  const platform = await new ContractFactory(artifact.abi, artifact.bytecode, alice).deploy();
  await platform.waitForDeployment();
  for (const asset of assets) {
    await (await platform.registerAsset(parseEther(asset.dailyPriceEth))).wait();
  }
  const config = {
    address: await platform.getAddress(), chainId: 31337, rpcUrl,
    runtimeCodeHash: keccak256(await provider.getCode(await platform.getAddress())),
  };
  appServer = await createViteServer({
    configFile: false,
    root: fileURLToPath(new URL("../frontend/", import.meta.url)),
    server: { ...localServerSecurity, host: "127.0.0.1", port: 0 },
    plugins: [createCataloguePlugin({
      readDeployment: async () => config,
      dataFile: fileURLToPath(new URL(`../cache/browser-catalogue-${Date.now()}.json`, import.meta.url)),
    }), {
      name: "isolated-test-config",
      transform(_source, id) {
        if (id.replaceAll("\\", "/").split("?")[0].endsWith("/src/config.js")) {
          return { code: `export const config = ${JSON.stringify(config)};`, map: null };
        }
      },
    }],
    logLevel: "error",
  });
  await appServer.listen();
  const appPort = appServer.httpServer.address().port;
  const url = `http://127.0.0.1:${appPort}`;
  const candidates = [
    process.env.BROWSER_EXECUTABLE,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "/usr/bin/chromium", "/usr/bin/google-chrome",
  ].filter(Boolean);
  let executablePath;
  for (const candidate of candidates) {
    try { await access(candidate); executablePath = candidate; break; } catch { /* Try next installed browser. */ }
  }
  if (!executablePath) throw new Error("Set BROWSER_EXECUTABLE to an installed Chrome or Edge executable.");
  browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
  await context.route("https://fonts.googleapis.com/**", route => route.abort());
  // EIP-1193 wallet mock: uses unlocked local TEST accounts, never real keys.
  // This exercises real browser + EVM transactions without approving MetaMask popups.
  await context.addInitScript(({ rpcUrl, addresses }) => {
    const listeners = new Map();
    const saved = JSON.parse(sessionStorage.getItem("testWallet") ?? "null");
    let connected = saved?.connected ?? false;
    let selected = saved?.selected ?? addresses[1];
    let authorized = saved?.authorized ?? [];
    let chainId = saved?.chainId ?? "0x1";
    let rejectNext = false;
    let rejectPermissions = false;
    let permissionRequests = 0;
    let id = 1;
    const emit = (event, value) => (listeners.get(event) ?? []).forEach(listener => listener(value));
    const save = () => sessionStorage.setItem("testWallet", JSON.stringify({ connected, selected, authorized, chainId }));
    window.ethereum = {
      isMetaMask: true,
      on(event, callback) { listeners.set(event, [...(listeners.get(event) ?? []), callback]); },
      async request({ method, params = [] }) {
        if (method === "eth_accounts") return connected ? authorized : [];
        if (method === "eth_requestAccounts") { connected = true; authorized = [selected]; save(); return authorized; }
        if (method === "wallet_requestPermissions") {
          permissionRequests++;
          if (rejectPermissions) {
            rejectPermissions = false;
            throw Object.assign(new Error("User rejected permissions"), { code: 4001 });
          }
          connected = true;
          authorized = [selected, ...addresses.filter(address => address !== selected)];
          save();
          emit("accountsChanged", authorized);
          return [{ parentCapability: "eth_accounts", caveats: [{ type: "restrictReturnedAccounts", value: authorized }] }];
        }
        if (method === "eth_chainId") return chainId;
        if (method === "wallet_switchEthereumChain") {
          chainId = params[0].chainId;
          save();
          emit("chainChanged", chainId);
          return null;
        }
        if (method === "wallet_addEthereumChain") return null;
        if (method === "eth_sendTransaction" && rejectNext) {
          rejectNext = false;
          throw Object.assign(new Error("User rejected request"), { code: 4001 });
        }
        const response = await fetch(rpcUrl, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: id++, method, params }),
        });
        const data = await response.json();
        if (data.error) throw Object.assign(new Error(data.error.message), data.error);
        return data.result;
      },
    };
    window.testWallet = {
      select(index) {
        selected = addresses[index];
        connected = true;
        authorized = [selected, ...authorized.filter(address => address !== selected)];
        save();
        emit("accountsChanged", authorized);
      },
      setChain(value) { chainId = value; save(); emit("chainChanged", value); },
      rejectNext() { rejectNext = true; },
      rejectNextPermissions() { rejectPermissions = true; },
      permissionRequests() { return permissionRequests; },
    };
  }, { rpcUrl, addresses });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.goto(url);
  await page.waitForFunction(() => document.querySelector("#chain-status").textContent.includes("connected"));
  for (const path of ["/server/catalogue.js", "/data/catalogue.json?raw"]) {
    const response = await page.request.get(`${url}${path}`);
    assert.equal(response.status(), 403);
  }
  console.log("PASS: server source and raw private catalogue files cannot be fetched through Vite.");
  const bike = page.locator('[data-asset-id="1"]');
  assert.match(await bike.locator(".daily-price").textContent(), /0\.01/);
  assert.equal(await bike.locator(".button-rent").isDisabled(), true);
  await page.getByRole("button", { name: "Cars", exact: true }).click();
  assert.equal(await bike.isVisible(), false);
  assert.equal(await page.locator('[data-asset-id="2"]').isVisible(), true);
  await page.getByRole("button", { name: /All assets/ }).click();
  console.log("PASS: chain catalogue loads without a wallet, and category filters work.");

  await page.locator("#connect").click();
  await page.locator(`.wallet-account[data-account="${addresses[1]}"]`).click();
  await page.waitForFunction(() => !document.querySelector('[data-asset-id="1"] .button-rent').disabled);
  assert.equal(await page.evaluate(() => window.ethereum.request({ method: "eth_chainId" })), "0x7a69");
  await bike.locator(".duration").fill("31");
  assert.equal(await bike.locator(".button-rent").isDisabled(), true);
  await bike.locator(".duration").fill("3");
  assert.equal(await bike.locator(".total-price").textContent(), "0.03 ETH");
  console.log("PASS: connection switches to the local chain, and duration validation uses exact prices.");

  await page.locator("#connect").click();
  await page.evaluate(() => window.testWallet.rejectNextPermissions());
  await page.locator("#manage-wallet-accounts").click();
  await page.waitForFunction(() => document.querySelector("#wallet-picker-status").textContent.includes("cancelled"));
  assert.match(await page.locator("#connect").textContent(), /0x7099/);
  await page.locator("#manage-wallet-accounts").click();
  await page.waitForFunction(() => document.querySelectorAll(".wallet-account").length === 3);
  assert.equal(await page.evaluate(() => window.testWallet.permissionRequests()), 2);
  await page.locator(`.wallet-account[data-account="${addresses[0]}"]`).click();
  await page.waitForFunction(() => document.querySelector('[data-asset-id="1"] .button-rent').textContent === "You own this asset");
  await page.reload();
  await page.waitForFunction(() => document.querySelector('[data-asset-id="1"] .button-rent').textContent === "You own this asset");
  assert.match(await page.locator("#connect").textContent(), /0xf39F/);
  await page.locator("#connect").click();
  await page.locator(`.wallet-account[data-account="${addresses[1]}"]`).click();
  await page.waitForFunction(() => !document.querySelector('[data-asset-id="1"] .button-rent').disabled);
  console.log("PASS: wallet picker manages account sharing, preserves a cancelled choice, switches accounts, and remembers the selection after reload.");

  await page.locator("#register-asset").click();
  assert.equal(await page.locator('#listing-form [name="id"]').count(), 0);
  await page.locator('#listing-form [name="name"]').fill("Camping Tent");
  await page.locator('#listing-form [name="category"]').selectOption("Other");
  await page.locator('#listing-form [name="description"]').fill("A tent for two people.");
  await page.locator('#listing-form [name="price"]').fill("0.002");
  await page.evaluate(() => window.testWallet.rejectNext());
  await page.locator("#submit-listing").click();
  await page.waitForFunction(() => document.querySelector("#listing-status").textContent.includes("cancelled"));
  assert.equal(await platform.usedAssetIds(4n), false);
  let failMetadataSave = true;
  await page.route("**/api/catalogue", route => {
    if (route.request().method() === "POST" && failMetadataSave) {
      failMetadataSave = false;
      return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Temporary test failure" }) });
    }
    return route.continue();
  });
  await page.locator("#submit-listing").click();
  await page.waitForFunction(() => document.querySelector("#listing-status").textContent.includes("Registration is confirmed on-chain"));
  assert.equal(await platform.usedAssetIds(4n), true);
  await page.locator("#submit-listing").click();
  const tent = page.locator('[data-asset-id="4"]');
  await page.waitForFunction(() => document.querySelector('[data-asset-id="4"] .asset-name')?.textContent === "Camping Tent");
  assert.equal((await platform.assets(4n)).owner, addresses[1]);
  assert.equal((await platform.getAssetIds()).length, 4);
  const badMetadata = await page.request.post(`${url}/api/catalogue`, { headers: { Origin: url }, data: {
    id: "4", name: "Tampered name", category: "Other", description: "A tent for two people.",
  } });
  assert.equal(badMetadata.status(), 409);
  const viewer = await browser.newContext();
  await viewer.route("https://fonts.googleapis.com/**", route => route.abort());
  const viewerPage = await viewer.newPage();
  await viewerPage.goto(url);
  await viewerPage.waitForFunction(() => document.querySelector('[data-asset-id="4"] .asset-name')?.textContent === "Camping Tent");
  await page.reload();
  await page.waitForFunction(() => document.querySelector('[data-asset-id="4"] .asset-name')?.textContent === "Camping Tent");
  console.log("PASS: registration is cancellable, metadata saves can be retried without a duplicate transaction, and listings persist across browsers.");

  await page.locator("#connect").click();
  await page.locator(`.wallet-account[data-account="${addresses[2]}"]`).click();
  assert.equal(await tent.locator(".button-remove").isVisible(), false);
  await tent.locator(".duration").fill("1");
  await tent.locator(".button-rent").click();
  await page.waitForFunction(() => document.querySelector('[data-asset-id="4"] .availability')?.textContent === "Your rental");
  await page.locator("#connect").click();
  await page.locator(`.wallet-account[data-account="${addresses[1]}"]`).click();
  await page.waitForFunction(() => document.querySelector("#balance").textContent === "0.002");
  assert.equal(await tent.locator(".button-remove").isDisabled(), true);
  const tentExpiry = (await platform.assets(4n)).rentedUntil;
  await provider.send("evm_setNextBlockTimestamp", [Number(tentExpiry)]);
  await provider.send("evm_mine", []);
  await page.locator("#refresh").click();
  await page.waitForFunction(() => !document.querySelector('[data-asset-id="4"] .button-remove').disabled);
  await tent.locator(".button-remove").click();
  await page.evaluate(() => window.testWallet.rejectNext());
  await page.locator("#confirm-remove").click();
  await page.waitForFunction(() => document.querySelector("#remove-status").textContent.includes("cancelled"));
  assert.equal((await platform.assets(4n)).owner, addresses[1]);
  await page.locator("#confirm-remove").click();
  await page.waitForFunction(() => !document.querySelector('[data-asset-id="4"]'));
  assert.equal(await platform.balances(addresses[1]), parseEther("0.002"));
  await viewerPage.locator("#refresh").click();
  await viewerPage.waitForFunction(() => !document.querySelector('[data-asset-id="4"]'));
  await page.locator("#withdraw").click();
  await page.waitForFunction(() => document.querySelector("#balance").textContent === "0.0");
  assert.equal(await platform.balances(addresses[1]), 0n);
  await page.locator("#register-asset").click();
  await page.locator('#listing-form [name="name"]').fill("Another asset");
  await page.locator('#listing-form [name="price"]').fill("0.01");
  await page.locator("#submit-listing").click();
  await page.waitForFunction(() => document.querySelector('[data-asset-id="5"] .asset-name')?.textContent === "Another asset");
  assert.equal(await platform.usedAssetIds(4n), true);
  assert.equal(await platform.nextAssetId(), 6n);
  console.log("PASS: the contract assigns a fresh ID after removal; only owners can remove, active rentals are protected, and earnings remain withdrawable.");

  await page.evaluate(() => window.testWallet.rejectNext());
  await bike.locator(".button-rent").click();
  await page.waitForFunction(() => document.querySelector("#notice").textContent.includes("cancelled"));
  await page.waitForFunction(() => !document.querySelector('[data-asset-id="1"] .button-rent').disabled);
  assert.equal((await platform.assets(1n)).renter, "0x0000000000000000000000000000000000000000");
  await bike.locator(".button-rent").click();
  await page.waitForFunction(() => document.querySelector('[data-asset-id="1"] .availability').textContent === "Your rental");
  assert.equal((await platform.assets(1n)).renter.toLowerCase(), addresses[1].toLowerCase());
  assert.equal(await platform.balances(addresses[0]), parseEther("0.03"));
  console.log("PASS: wallet rejection preserves state; confirming a rental transfers 0.03 ETH and grants access.");

  await page.locator("#connect").click();
  await page.locator(`.wallet-account[data-account="${addresses[2]}"]`).click();
  await page.waitForFunction(() => document.querySelector('[data-asset-id="1"] .availability').textContent === "Rented");
  assert.equal(await bike.locator(".button-rent").isDisabled(), true);
  await page.locator("#connect").click();
  await page.locator(`.wallet-account[data-account="${addresses[0]}"]`).click();
  await page.waitForFunction(() => document.querySelector("#balance").textContent === "0.03");
  await page.evaluate(() => window.testWallet.setChain("0x1"));
  await page.waitForFunction(() => !document.querySelector("#switch-network").hidden);
  assert.equal(await page.locator("#withdraw").isDisabled(), true);
  await page.locator("#switch-network").click();
  await page.waitForFunction(() => !document.querySelector("#withdraw").disabled);
  await page.locator("#withdraw").click();
  await page.waitForFunction(() => document.querySelector("#notice").textContent.includes("Withdrawal confirmed"));
  await page.waitForFunction(() => document.querySelector("#balance").textContent === "0.0");
  assert.equal(await platform.balances(addresses[0]), 0n);
  assert.equal(await page.locator("#withdraw").isDisabled(), true);
  console.log("PASS: the chosen account sends withdrawals even when it is not the first authorized account; network changes update controls.");

  const { rentedUntil } = await platform.assets(1n);
  await provider.send("evm_setNextBlockTimestamp", [Number(rentedUntil)]);
  await provider.send("evm_mine", []);
  await page.evaluate(() => window.testWallet.select(1));
  await page.waitForFunction(() => document.querySelector('[data-asset-id="1"] .availability').textContent === "Available");
  await page.waitForFunction(() => !document.querySelector('[data-asset-id="1"] .button-rent').disabled);
  assert.equal(await platform.currentPossessor(1n), addresses[0]);
  console.log("PASS: expiry returns access to Alice and enables a new rental.");

  await mkdir(new URL("../cache/", import.meta.url), { recursive: true });
  await page.screenshot({ path: fileURLToPath(new URL("../cache/phase-three-desktop.png", import.meta.url)), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.screenshot({ path: fileURLToPath(new URL("../cache/phase-three-mobile.png", import.meta.url)), fullPage: true });
  assert.deepEqual(pageErrors, []);
  console.log("PASS: mobile layout fits the screen; no browser runtime errors.");

  // Separate context without a wallet extension.
  const noWallet = await browser.newContext();
  await noWallet.route("https://fonts.googleapis.com/**", route => route.abort());
  const noWalletPage = await noWallet.newPage();
  await noWalletPage.goto(url);
  await noWalletPage.locator("#connect").click();
  await noWalletPage.waitForFunction(() => document.querySelector("#notice").textContent.includes("Install and unlock"));
  console.log("PASS: missing MetaMask produces a readable message.");
  // Large catalogues must not produce an unbounded set of RPC reads or cards.
  for (let index = 0; index < 52; index++) await (await platform.registerAsset(0n)).wait();
  await page.locator("#refresh").click();
  await page.waitForFunction(() => document.querySelectorAll(".asset-card").length === 50);
  await page.locator("#catalogue-next").click();
  await page.waitForFunction(() => document.querySelector("#catalogue-page").textContent.startsWith("Page 2") && document.querySelectorAll(".asset-card").length === 6 && document.querySelector("#asset-grid").getAttribute("aria-busy") === "false");
  assert.equal(await page.locator(".asset-card").count(), 6);
  await page.locator("#catalogue-previous").click();
  await page.waitForFunction(() => document.querySelectorAll(".asset-card").length === 50);
  assert.deepEqual(pageErrors, []);
  console.log("PASS: a 56-asset catalogue is read and rendered in pages of at most 50.");
  console.log("Browser verification completed on an isolated chain; your running demo node was not changed.");
} finally {
  await browser?.close();
  await appServer?.close();
  provider?.destroy();
  await chainServer.close();
}
