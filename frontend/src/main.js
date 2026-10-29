import "./style.css";
import { assets } from "./assets.js";
import { config, createReadConnection, ensureLocalChain, readSnapshot, walletContract } from "./contract.js";
import { eth, expiryDate, friendlyError, parseDuration, quote, rentalState, sameAddress, shortAddress } from "./rental.js";
import { chooseAuthorizedAccount, requestAccountPermissions } from "./wallet.js";
import { metadataHash, normalizeDetails, normalizeMetadata, parseDailyPrice, publishMetadata, registrationIdFromReceipt } from "./catalogue.js";

const $ = selector => document.querySelector(selector);
const injected = window.ethereum?.providers?.find(provider => provider.isMetaMask) ?? window.ethereum;
const state = { account: null, walletAccounts: [], walletChain: null, snapshot: null, busy: false, refreshing: false, category: "All", page: 0, version: 0, catalogue: assets.map(asset => ({ ...asset, id: String(asset.id) })) };
const cards = new Map();
let connection;
let preferredAccount = null;
let removalTarget = null;
let listingDrafts = {};
let registrationId = null;
let registrationTx = null;
const draftKey = `blockrent.listingDrafts.${config.chainId}.${config.address}`;
try { listingDrafts = JSON.parse(localStorage.getItem(draftKey) ?? "{}"); } catch { /* Draft storage is optional. */ }
try { preferredAccount = localStorage.getItem("blockrent.selectedAccount"); } catch { /* Storage is optional. */ }

function saveListingDrafts() {
  try { localStorage.setItem(draftKey, JSON.stringify(listingDrafts)); } catch { /* Keep in-memory drafts when storage is unavailable. */ }
}

function rememberAccount(account) {
  preferredAccount = account;
  try {
    if (account) localStorage.setItem("blockrent.selectedAccount", account);
    else localStorage.removeItem("blockrent.selectedAccount");
  } catch { /* Account selection still works when browser storage is blocked. */ }
}

function notify(message, kind = "info") {
  const notice = $("#notice");
  notice.textContent = message;
  notice.className = `notice notice-${kind}`;
  notice.hidden = false;
  if ($("#wallet-picker").open) {
    $("#wallet-picker-status").textContent = kind === "error" ? message : "";
  }
  if ($("#listing-dialog").open) $("#listing-status").textContent = message;
  if ($("#remove-dialog").open) $("#remove-status").textContent = message;
}

function correctChain() {
  return state.walletChain !== null && BigInt(state.walletChain) === BigInt(config.chainId);
}

function recordFor(asset) {
  return state.snapshot?.records[state.catalogue.findIndex(entry => String(entry.id) === String(asset.id))];
}

function createCard(asset) {
  const card = $("#asset-template").content.firstElementChild.cloneNode(true);
  card.dataset.assetId = asset.id;
  card.dataset.metadata = JSON.stringify(asset);
  card.querySelector(".asset-image").classList.add(`image-${asset.category.toLowerCase()}`);
  card.querySelector(".asset-photo").src = asset.image;
  card.querySelector(".asset-photo").alt = asset.name;
  card.querySelector(".asset-id").textContent = `NO. 00${asset.id}`;
  card.querySelector(".asset-category").textContent = asset.category;
  card.querySelector(".asset-name").textContent = asset.name;
  card.querySelector(".asset-description").textContent = asset.description;
  for (const [name, value] of Object.entries(asset.attributes)) {
    const attribute = document.createElement("span");
    attribute.textContent = value;
    attribute.title = name;
    card.querySelector(".attributes").append(attribute);
  }
  card.querySelector(".duration").id = `days-${asset.id}`;
  card.querySelector(".duration").addEventListener("input", () => renderCard(asset));
  card.querySelector(".button-rent").addEventListener("click", () => rent(asset));
  card.querySelector(".button-remove").addEventListener("click", () => {
    removalTarget = asset;
    $("#remove-description").textContent = `Remove ${asset.name} (#${asset.id}) from the catalogue?`;
    $("#remove-status").textContent = "";
    $("#remove-dialog").showModal();
    render();
  });
  card.querySelector(".finish-details").addEventListener("click", () => openListing(asset.id));
  $("#asset-grid").append(card);
  cards.set(String(asset.id), card);
}

function reconcileCards() {
  const ids = new Set(state.catalogue.map(asset => String(asset.id)));
  for (const [id, card] of cards) {
    if (!ids.has(id)) { card.remove(); cards.delete(id); }
  }
  for (const asset of state.catalogue) {
    const card = cards.get(String(asset.id));
    if (card && card.dataset.metadata !== JSON.stringify(asset)) {
      card.remove();
      cards.delete(String(asset.id));
    }
    if (!cards.has(String(asset.id))) createCard(asset);
  }
}

function renderCard(asset) {
  const card = cards.get(String(asset.id));
  card.hidden = state.category !== "All" && state.category !== asset.category;
  const record = recordFor(asset);
  const info = rentalState(record, state.snapshot?.timestamp ?? 0, state.account);
  const registered = record && info.status !== "unregistered";
  const badge = card.querySelector(".availability");
  badge.textContent = !state.snapshot ? "Offline" : info.label;
  badge.className = `availability ${registered ? info.status : "unregistered"}`;
  card.querySelector(".daily-price").textContent = registered ? eth(record.pricePerDay) : "—";
  const owner = card.querySelector(".owner-address");
  owner.textContent = registered ? `${shortAddress(record.owner)}${info.owns ? " (you)" : ""}` : "—";
  owner.title = registered ? record.owner : "";
  const possessor = card.querySelector(".possessor-address");
  possessor.textContent = registered ? `${shortAddress(info.possessor)}${sameAddress(info.possessor, state.account) ? " (you)" : ""}` : "—";
  possessor.title = info.possessor ?? "";
  card.querySelector(".expiry-row").hidden = !info.active;
  card.querySelector(".rental-expiry").textContent = info.active ? expiryDate(record.rentedUntil) : "—";
  const input = card.querySelector(".duration");
  input.disabled = state.busy;
  let valid = true;
  try {
    parseDuration(input.value);
    input.setCustomValidity("");
    card.querySelector(".total-price").textContent = registered ? `${eth(quote(record.pricePerDay, input.value))} ETH` : "—";
  } catch (error) {
    valid = false;
    input.setCustomValidity(error.message);
    card.querySelector(".total-price").textContent = "Choose 1–30 days";
  }
  const button = card.querySelector(".button-rent");
  button.disabled = state.busy || !valid || !info.canRent || !correctChain();
  button.textContent = state.busy ? "Transaction in progress…" : !registered ? "Listing unavailable" : !state.account ? "Connect wallet to rent" : !correctChain() ? "Switch wallet network" : info.owns ? "You own this asset" : info.renting ? "Your rental is active" : info.active ? "Currently rented" : "Rent this asset ↗";
  card.querySelector(".card-hint").textContent = info.active ? "Access returns to the owner at expiry." : info.owns ? "Switch to a different wallet to rent this asset." : "Payment is confirmed through MetaMask.";
  const remove = card.querySelector(".button-remove");
  remove.hidden = !info.owns;
  remove.disabled = state.busy || info.active || !correctChain();
  remove.title = info.active ? "An active rental must expire before removal." : "Remove this asset from the catalogue";
  const finish = card.querySelector(".finish-details");
  finish.hidden = !info.owns || !asset.metadataMissing;
  finish.disabled = state.busy || !correctChain();
}

function render() {
  reconcileCards();
  state.catalogue.forEach(renderCard);
  $("#asset-count").textContent = state.snapshot?.totalCount ?? state.catalogue.length;
  document.querySelectorAll(".filter").forEach(filter => {
    const active = filter.dataset.category === state.category;
    filter.classList.toggle("active", active);
    filter.setAttribute("aria-pressed", String(active));
  });
  $(".collection-count").textContent = `${state.snapshot?.totalCount ?? state.catalogue.length} useful things. Endless plans.`;
  const pages = Math.max(1, Math.ceil((state.snapshot?.totalCount ?? 0) / 50));
  $("#catalogue-pagination").hidden = pages === 1;
  $("#catalogue-page").textContent = `Page ${state.page + 1} of ${pages} · filters apply to this page`;
  $("#catalogue-previous").disabled = state.busy || state.refreshing || state.page === 0;
  $("#catalogue-next").disabled = state.busy || state.refreshing || state.page + 1 >= pages;
  $("#empty-catalogue").hidden = !state.snapshot || state.catalogue.some(asset => state.category === "All" || asset.category === state.category);
  $("#catalogue-warning").hidden = !state.snapshot?.catalogueWarning;
  $("#catalogue-warning").textContent = state.snapshot?.catalogueWarning ?? "";
  $("#register-asset").disabled = state.busy || !state.account || !correctChain() || !state.snapshot;
  $("#register-asset").title = state.account ? "Register an asset with your connected wallet" : "Connect a wallet to register an asset";
  $("#listing-owner").textContent = shortAddress(state.account);
  $("#listing-form").querySelectorAll("input, select, textarea, button").forEach(input => { input.disabled = state.busy; });
  $("#submit-listing").disabled = state.busy || !state.account || !correctChain();
  $("#submit-listing").textContent = registrationId ? "Save listing details" : "Register asset";
  $("#listing-id-note").textContent = registrationId ? `Confirmed asset ID: ${registrationId}` : "Your asset ID is assigned automatically after confirmation.";
  $("#close-remove").disabled = state.busy;
  const removal = removalTarget && rentalState(recordFor(removalTarget), state.snapshot?.timestamp ?? 0, state.account);
  $("#confirm-remove").disabled = state.busy || !correctChain() || !removal?.owns || removal.active;
  $("#asset-grid").setAttribute("aria-busy", String(state.refreshing));
  $("#connect").textContent = state.account ? `${shortAddress(state.account)} · Switch` : "Connect MetaMask ↗";
  $("#connect").title = state.account ? `Connected: ${state.account}. Click to choose a wallet.` : "Connect your MetaMask wallet";
  $("#connect").disabled = state.busy;
  $("#switch-network").hidden = !state.account || correctChain();
  $("#switch-network").disabled = state.busy;
  $("#refresh").disabled = state.refreshing || state.busy;
  $("#balance").textContent = state.account && state.snapshot ? eth(state.snapshot.balance) : "—";
  $("#withdraw").disabled = state.busy || !correctChain() || !state.account || !state.snapshot || state.snapshot.balance === 0n;
  $("#withdraw").textContent = state.busy ? "Transaction in progress…" : "Withdraw earnings ↗";
  $("#earnings-hint").textContent = !state.account ? "Connect your wallet to see your earnings." : !correctChain() ? "Switch MetaMask to Hardhat Local." : state.snapshot?.balance > 0n ? "Available now. Wallet transaction gas applies." : "No earnings to withdraw yet.";
  $("#chain-status").textContent = state.snapshot ? `Local blockchain connected · Block ${state.snapshot.blockNumber}` : "Local blockchain unavailable";
  $("#chain-dot").className = state.snapshot ? "dot" : "dot dot-muted";
  renderWalletPicker();
}

function renderWalletPicker() {
  const list = $("#wallet-accounts");
  const signature = state.walletAccounts.join(",");
  if (list.dataset.accounts !== signature) {
    list.dataset.accounts = signature;
    list.replaceChildren();
    for (const account of state.walletAccounts) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "wallet-account";
      button.dataset.account = account;
      const address = document.createElement("span");
      address.textContent = account;
      const status = document.createElement("small");
      button.append(address, status);
      button.addEventListener("click", () => walletAction(async () => {
        const accounts = await injected.request({ method: "eth_accounts" });
        if (!accounts.some(authorized => sameAddress(authorized, account))) {
          await syncWallet();
          throw new Error("That account is no longer shared. Choose accounts in MetaMask and try again.");
        }
        await ensureLocalChain(injected);
        rememberAccount(account);
        await syncWallet();
        $("#wallet-picker").close();
        notify(`Using wallet ${shortAddress(account)} on Hardhat Local.`, "success");
      }));
      list.append(button);
    }
  }
  list.querySelectorAll(".wallet-account").forEach(button => {
    const selected = sameAddress(button.dataset.account, state.account);
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
    button.querySelector("small").textContent = selected ? "Selected" : "Use this wallet";
    button.disabled = state.busy;
  });
  $("#manage-wallet-accounts").disabled = state.busy;
  $("#close-wallet-picker").disabled = state.busy;
}

async function refresh(reportSuccess = false) {
  if (state.refreshing) return;
  state.refreshing = true;
  const version = state.version;
  render();
  try {
    connection ??= createReadConnection();
    const snapshot = await readSnapshot(connection, assets, state.account, state.page);
    if (version !== state.version) return;
    state.snapshot = snapshot;
    state.catalogue = snapshot.catalogue;
    state.page = snapshot.page;
    if (reportSuccess) notify("Prices, rentals, and earnings are up to date.", "success");
  } catch (error) {
    if (version === state.version) {
      state.snapshot = null;
      notify(friendlyError(error), "error");
    }
  } finally {
    state.refreshing = false;
    render();
    // An account/chain event during the request needs its own fresh snapshot.
    if (version !== state.version) void refresh();
  }
}

async function syncWallet() {
  state.version++;
  state.account = null;
  state.snapshot = null;
  render();
  if (!injected) return refresh();
  const version = state.version;
  try {
    const [accounts, chainId] = await Promise.all([
      injected.request({ method: "eth_accounts" }),
      injected.request({ method: "eth_chainId" }),
    ]);
    if (version !== state.version) return;
    state.walletAccounts = accounts;
    state.account = chooseAuthorizedAccount(accounts, preferredAccount);
    state.walletChain = chainId;
  } catch (error) {
    notify(friendlyError(error), "error");
  }
  render();
  await refresh();
}

async function walletAction(action) {
  if (state.busy) return;
  state.busy = true;
  render();
  try {
    await action();
  } catch (error) {
    notify(friendlyError(error), "error");
  } finally {
    state.busy = false;
    await refresh();
    render();
  }
}

async function rent(asset) {
  await walletAction(async () => {
    const days = parseDuration(cards.get(String(asset.id)).querySelector(".duration").value);
    const account = state.account;
    if (!account || !injected) throw new Error("Connect MetaMask first.");
    const contract = await walletContract(injected, account);
    // Read the current chain price again immediately before requesting payment.
    const record = await contract.assets(asset.id);
    const block = await contract.runner.provider.getBlock("latest");
    const info = rentalState(record, block.timestamp, account);
    if (!info.canRent) throw new Error(info.owns ? "You cannot rent your own asset." : "This asset is no longer available. Refresh the catalogue.");
    const value = quote(record.pricePerDay, days);
    notify(`Confirm ${eth(value)} ETH for ${asset.name} in MetaMask. Gas is separate.`);
    const transaction = await contract.rentAsset(asset.id, days, { value });
    notify("Rental submitted. Waiting for blockchain confirmation…");
    await transaction.wait();
    notify(`${asset.name} rented for ${days} days by ${shortAddress(account)}. Payment confirmed.`, "success");
  });
}

function openListing(id = null) {
  $("#listing-form").reset();
  const draft = id !== null ? listingDrafts[String(id)] : listingDrafts[`pending:${state.account?.toLowerCase()}`];
  registrationId = id === null ? null : String(id);
  registrationTx = draft?.transactionHash ?? null;
  if (draft) {
    for (const [name, value] of Object.entries(draft)) {
      const input = $("#listing-form").elements.namedItem(name);
      if (input) input.value = value;
    }
  }
  $("#listing-title").textContent = id === null ? "Share a new asset" : "Finish listing details";
  $("#listing-status").textContent = id === null ? "" : "Use the same details and price as the original registration. Submitting again will finish saving them.";
  $("#listing-dialog").showModal();
  render();
}

$("#register-asset").addEventListener("click", () => openListing());
$("#close-listing").addEventListener("click", () => $("#listing-dialog").close());
$("#close-remove").addEventListener("click", () => $("#remove-dialog").close());
for (const selector of ["#listing-dialog", "#remove-dialog"]) {
  $(selector).addEventListener("cancel", event => { if (state.busy) event.preventDefault(); });
}

$("#listing-form").addEventListener("submit", event => {
  event.preventDefault();
  // Collect fields before walletAction disables the form during confirmation.
  const fields = Object.fromEntries(new FormData(event.currentTarget));
  void walletAction(async () => {
    const details = normalizeDetails(fields);
    const price = parseDailyPrice(fields.price);
    const account = state.account;
    if (!account || !injected) throw new Error("Connect a wallet first.");
    const contract = await walletContract(injected, account);
    const commitment = metadataHash(details);
    const pendingKey = `pending:${account.toLowerCase()}`;
    if (registrationId === null) {
      let receipt;
      if (registrationTx) {
        // Recover a transaction submitted before a reload without sending it twice.
        receipt = await contract.runner.provider.getTransactionReceipt(registrationTx);
        if (!receipt) throw new Error("The earlier registration is still pending. Try again after it confirms in MetaMask.");
        if (receipt.status === 0) {
          registrationTx = null;
          delete listingDrafts[pendingKey];
          saveListingDrafts();
          throw new Error("The earlier registration failed. Submit again to register your asset.");
        }
      } else {
        const draft = { ...details, price: String(fields.price) };
        listingDrafts[pendingKey] = draft;
        saveListingDrafts();
        notify(`Confirm registration of ${details.name} in MetaMask. The contract will assign its ID.`);
        const transaction = await contract.registerAssetWithMetadata(price, commitment);
        registrationTx = transaction.hash;
        listingDrafts[pendingKey] = { ...draft, transactionHash: transaction.hash };
        saveListingDrafts();
        notify("Registration submitted. Waiting for its assigned ID…");
        receipt = await transaction.wait();
      }
      registrationId = registrationIdFromReceipt(receipt, config.address, contract.interface);
      listingDrafts[registrationId] = { ...listingDrafts[pendingKey], id: registrationId };
      delete listingDrafts[pendingKey];
      saveListingDrafts();
      render();
    }
    const record = await contract.assets(registrationId);
    if (!sameAddress(record.owner, account) || await contract.metadataHashes(registrationId) !== commitment || record.pricePerDay !== price) {
      throw new Error("These details or this wallet do not match the confirmed registration. Restore the original values to finish saving.");
    }
    const metadata = normalizeMetadata({ ...details, id: registrationId });
    try {
      await publishMetadata(metadata);
    } catch (error) {
      throw new Error(`Registration is confirmed on-chain, but the details were not saved. Submit this form again to finish. ${friendlyError(error)}`);
    }
    delete listingDrafts[metadata.id];
    saveListingDrafts();
    state.category = "All";
    state.page = Math.floor((Number(await contract.getAssetCount()) - 1) / 50);
    state.version++;
    $("#listing-dialog").close();
    notify(`${metadata.name} (#${metadata.id}) is registered and ready to rent.`, "success");
  });
});

$("#confirm-remove").addEventListener("click", () => walletAction(async () => {
  const asset = removalTarget;
  const account = state.account;
  if (!asset || !account || !injected) throw new Error("Select an asset and connect its owner wallet first.");
  const contract = await walletContract(injected, account);
  notify(`Confirm removal of ${asset.name} in MetaMask.`);
  const transaction = await contract.removeAsset(asset.id);
  notify("Removal submitted. Waiting for blockchain confirmation…");
  await transaction.wait();
  $("#remove-dialog").close();
  notify(`${asset.name} removed. Your earned balance remains withdrawable.`, "success");
  removalTarget = null;
}));

$("#connect").addEventListener("click", () => walletAction(async () => {
  if (!injected) throw new Error("Install and unlock the MetaMask browser extension, then reload this page.");
  const accounts = await injected.request({ method: "eth_accounts" });
  if (accounts.length === 0) await injected.request({ method: "eth_requestAccounts" });
  await syncWallet();
  $("#wallet-picker-status").textContent = "";
  if (!$("#wallet-picker").open) $("#wallet-picker").showModal();
}));

$("#close-wallet-picker").addEventListener("click", () => $("#wallet-picker").close());
$("#wallet-picker").addEventListener("cancel", event => {
  if (state.busy) event.preventDefault();
});
$("#manage-wallet-accounts").addEventListener("click", () => walletAction(async () => {
  try {
    await requestAccountPermissions(injected);
  } catch (error) {
    if (error.code === 4200 || error.code === -32601) {
      throw new Error("Manage this site's connected accounts in MetaMask, then reopen this wallet picker.");
    }
    throw error;
  }
  await syncWallet();
  $("#wallet-picker-status").textContent = "Choose the wallet you want to use from the list above.";
}));

$("#switch-network").addEventListener("click", () => walletAction(async () => {
  await ensureLocalChain(injected);
  await syncWallet();
  notify("Wallet switched to Hardhat Local.", "success");
}));

$("#withdraw").addEventListener("click", () => walletAction(async () => {
  const account = state.account;
  if (!account || !injected) throw new Error("Connect MetaMask first.");
  const contract = await walletContract(injected, account);
  const balance = await contract.balances(account);
  if (balance === 0n) throw new Error("No balance to withdraw.");
  notify(`Confirm withdrawal of ${eth(balance)} ETH in MetaMask.`);
  const transaction = await contract.withdraw();
  notify("Withdrawal submitted. Waiting for blockchain confirmation…");
  await transaction.wait();
  notify(`Withdrawal confirmed for ${shortAddress(account)}. The ETH has been sent to that wallet.`, "success");
}));

$("#refresh").addEventListener("click", () => refresh(true));
for (const [selector, step] of [["#catalogue-previous", -1], ["#catalogue-next", 1]]) {
  $(selector).addEventListener("click", () => {
    state.page = Math.max(0, state.page + step);
    state.version++;
    void refresh();
  });
}
document.querySelectorAll(".filter").forEach(button => button.addEventListener("click", () => {
  state.category = button.dataset.category;
  document.querySelectorAll(".filter").forEach(filter => {
    filter.classList.toggle("active", filter === button);
    filter.setAttribute("aria-pressed", String(filter === button));
  });
  render();
}));

injected?.on?.("accountsChanged", accounts => {
  rememberAccount(accounts[0] ?? null);
  void syncWallet();
});
injected?.on?.("chainChanged", () => void syncWallet());
injected?.on?.("disconnect", () => {
  state.version++;
  state.account = null;
  state.walletAccounts = [];
  state.walletChain = null;
  state.snapshot = null;
  render();
  void refresh();
});

await syncWallet();
const refreshTimer = setInterval(() => { if (!state.busy) void refresh(); }, 8_000);
window.addEventListener("pagehide", () => {
  clearInterval(refreshTimer);
  connection?.provider.destroy();
}, { once: true });
