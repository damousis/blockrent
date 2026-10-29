# BlockRent backend security assessment and treatment plan

Assessment date: **29 October 2026**. Scope: this workspace's current source and
local development architecture. Owners below are proposed roles for the project
owner to assign. This is a code review with regression evidence, not an independent
audit, certification, or proof that every vulnerability has been eliminated.

## 1. Basis and scope

The requested [OWASP Smart Contract Top 10 Changes page](https://scs.owasp.org/sctop10/#changes)
currently identifies the **2026** edition. This assessment uses those identifiers,
rather than mixing them with 2025 numbering. The Top 10 is an awareness reference;
we also assess availability using [SCSVS-BLOCK-1](https://scs.owasp.org/SCSVS/controls/SCSVS-BLOCK-1/).
HTTP and filesystem findings are application-layer findings, not claims that a
Solidity category directly specifies HTTP controls.

Reviewed components:

| Component | Assets at risk | Trust boundary |
| --- | --- | --- |
| `contracts/RentalPlatform.sol` | Owner credits, held ETH, rental permissions, IDs | Arbitrary transaction sender → EVM checks |
| `frontend/server/catalogue.js` | Description integrity and availability | Untrusted HTTP request → local API → trusted RPC |
| `frontend/server/catalogue-store.js` | Shared JSON catalogue | Multiple writer processes → filesystem |
| Vite configuration and server | Backend source, generated files, service availability | Browser/network client → development server |
| Setup, dependencies, deployment config | Contract identity, old credits, build integrity | Trusted operator/build tools → deployed version |
| Frontend blockchain reads | Accurate, usable catalogue | RPC responses and stored descriptions → UI |

Attackers considered: an arbitrary wallet, a malicious website visiting local
services through a browser, a malformed/flooding API client, and concurrent writer
processes. A compromised operating-system administrator, malicious compiler,
wallet extension compromise, and a dishonest RPC are recorded trust assumptions
that are not solved by these patches. The API uses only a configured loopback
RPC on chain 31337 and verifies the configured runtime bytecode hash. That is
not a cryptographic light-client proof against a dishonest RPC.

The app is a local test-ETH demo. It has no oracle, flash-loan integration,
proxy, upgrade administrator, NFT, or real physical ownership verification.

## 2. How risks are scored

Use **likelihood × impact**, each from 1 to 5. These are project-specific
qualitative ratings, not measured probabilities or OWASP-issued scores.

| Value | Likelihood | Impact |
| --- | --- | --- |
| 1 | Requires unusual conditions under the assessed local setup | Small, recoverable inconvenience |
| 2 | Possible with a specific input or operational mistake | Limited user/session disruption |
| 3 | Practical with ordinary access or concurrent activity | Broad service/data loss requiring recovery |
| 4 | Easy and repeatable under an exposed deployment | Major business or financial harm |
| 5 | Expected without an effective control | Irrecoverable funds or system-wide compromise |

Priority bands: **1–5 Low**, **6–11 Medium**, **12–19 High**, **20–25 Critical**.
Impact includes data and service loss, not only ETH. Scores in the
[risk register](risk-register.csv) describe the current local deployment boundary.
Re-score before internet exposure or real assets: public development keys/RPC
would become Critical (4 × 5 = 20). A Low residual score is not permission to
deploy with real funds.

## 3. OWASP 2026 applicability and evidence

The category names below follow the [2026 ranking](https://scs.owasp.org/sctop10/#2026-ranking).
The applicability and conclusions are this project's own review findings.

| Category | Assessment for BlockRent | Control / evidence |
| --- | --- | --- |
| SC01 Access Control | Applicable | `removeAsset` checks recorded owner; `withdraw` uses only `balances[msg.sender]`. Tests reject other wallets. API content is authorized by the registrant's on-chain metadata hash, not a claimed owner in JSON. |
| SC02 Business Logic | Applicable | Exact payment; owner cannot self-rent; active rental cannot be overwritten/removed; access returns at exact expiry; removed IDs are not reused; old deployments are not automatically migrated. |
| SC03 Price Oracle Manipulation | Not presently applicable | No oracle or external exchange-rate input. Daily prices are chosen by registrants and stored in wei. Reassess if fiat conversion affects settlement. |
| SC04 Flash Loan–Facilitated Attacks | No identified integration-specific path | Rental authorization and the nominal fee do not depend on account wealth, voting power, or manipulable liquidity. This does not prove every future composition safe. |
| SC05 Lack of Input Validation | Applicable; patched gaps | Contract-level price cap; duration bounds; strict metadata types; bounded IDs, JSON bodies, queries, pages and store size. HTTP checks are supplementary application controls. |
| SC06 Unchecked External Calls | Applicable; existing control verified | Withdrawal requires successful ETH delivery. A failed recipient transfer reverts, restoring credit. No unchecked low-level call was found in the application contract. |
| SC07 Arithmetic Errors | Applicable | ETH is integer wei; exact multiplication and equality; no floating-point accounting or interest/share rounding. Frontend uses bigint. |
| SC08 Reentrancy | Applicable; existing control verified | Credit is zeroed before the recipient call. Malicious-recipient tests attempt a nested withdrawal and verify other owners' funds remain. No demonstrated withdrawal-drain bug was found. |
| SC09 Integer Overflow/Underflow | Applicable; patched input gap | Solidity 0.8.34 checked arithmetic is retained. Prices above `uint256.max / 30` are rejected at registration instead of creating a listing that panics for a valid duration. |
| SC10 Proxy/Upgradeability | Not presently applicable | No proxy or delegated upgrade mechanism. Deploying new source creates a separate instance; deployment and credit continuity remain operational risks. |

Existing authorization and withdrawal behavior was tested, not rewritten simply
to add a modifier. In particular, the review did not establish a theft exploit
that would justify calling the current CEI withdrawal flow vulnerable.

## 4. Findings and implemented treatment

| ID | Concrete before-state / scenario | Treatment in this change | Before → residual | Status |
| --- | --- | --- | --- | --- |
| R01 | Direct contract callers could register an enormous daily price even though the browser rejected it. Multiplication for allowed durations could panic. | `MAX_PRICE_PER_DAY` enforced before allocating an ID; boundary tests and solvency fuzzing. | 6 → 2 | Mitigated |
| R02 | Full-array asset enumeration, full metadata responses and RPC reads grew with every registration. | Contract pages capped at 50; legacy `getAssetIds()` now returns only the first page; UI navigates pages; API returns at most 50 requested descriptions. | 9 → 4 | Mitigated |
| R03 | No request-rate, slow-body, RPC deadline or RPC concurrency controls. | Per-socket-IP limits, body deadline, bounded active requests/RPC slots, bounded file reads and HTTP limits. | 9 → 4 | Mitigated |
| R04 | Origin checking was optional and host-only; Vite could serve workspace/backend files outside the intended page assets. | Exact local Host/port and write Origin checks; no cross-origin CORS; explicit filesystem allow/deny rules. | 6 → 3 | Mitigated |
| R05 | API queue serialized only API writes. Setup could read an older file and overwrite another process's new listing. | Shared exclusive file lock and atomic replacement, used by both writers; fsync before rename; bounded lock wait. | 9 → 3 | Mitigated |
| R06 | Some non-string JSON values were silently converted to text; IDs had no pre-conversion length cap. | Object/type checks, bounded decimal ID parsing, strict JSON MIME and no compressed bodies. | 6 → 2 | Mitigated |
| R07 | A lost disk or crashed writer can make description storage unavailable. | Failed/corrupt writes fail closed; previous valid file is preserved on write failure. Backup/restore automation and crash-lock recovery remain operational work. | 6 → 6 | OPEN |
| R08 | Development wallets are public and the node can sign from unlocked accounts. | Loopback website; documented `npm.cmd run node:local` binds RPC to 127.0.0.1. No claim that demo keys become safe for real use. | 5 → 5 locally | Local demo only |
| R09 | npm reports 7 High package entries caused by one Zod advisory. | Evidence captured; no incompatible override/downgrade applied. Compatible upstream remediation remains required. | 6 → 6 | OPEN |
| R10 | Recipient callbacks or rejected ETH delivery could threaten payout correctness if CEI were broken. | Existing CEI and checked-call behavior preserved and tested; added solvency fuzz tests. | 5 → 5 | Existing controls verified |
| R11 | Wallet registration could be mistaken for proof of physical ownership. | Document the demo assumption. Real asset verification/delivery requires product controls. | 6 → 6 | Demo-only acceptance |
| R12 | Operators may believe redeployment moved old balances and rentals. | Preserve old config/history; document old withdrawals and bytecode/version checks. | 6 → 3 | Residual operational risk |

“Mitigated” means the specific path was reduced by the controls and tests listed.
It does not mean availability or security is guaranteed under arbitrary load.
Trusted local clients can forge HTTP Origin headers: Origin is browser isolation,
not wallet authentication. The actual metadata authorization is matching the
on-chain commitment. Anyone can republish exactly matching public content; they
cannot use this endpoint to alter price, owner, renter, expiry or withdrawals.

## 5. Implemented operating limits

| Boundary | Current limit / response |
| --- | --- |
| Metadata POST size | 8,192 bytes; oversized requests receive 413 |
| Body read deadline | 3 seconds; stalled bodies receive 408 |
| API rate per direct socket IP | 30 POSTs and 120 GETs per 60 seconds; excess receives 429 |
| Concurrent catalogue requests | 8; excess receives 503 |
| Concurrent RPC verifications | 4; excess receives 503 |
| RPC validation deadline | 5 seconds overall and bounded transport requests |
| HTTP server | 10-second headers/request deadlines, 5-second keepalive, 100 connections |
| Page / metadata query | At most 50 asset IDs per response |
| Catalogue file | At most 8 MiB; read/write fails closed at the limit |
| Cross-process write lock | At most 2 seconds waiting; no automatic stale-lock deletion |

These values suit a small local demo and are engineering defaults, not measured
production capacity. Browsers on the same machine share an IP quota. No trust is
placed in `X-Forwarded-For`. Production deployment behind a proxy needs an explicit
trusted-proxy policy and gateway rate/connection limits. Filters apply to the
current catalogue page, as indicated on the page.

## 6. Dependency exception requiring follow-up

The [tracked audit summary](dependency-audit.json) records **7 High package
entries, 1 unique advisory**: [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).
The installed Zod version is 3.25.76; the advisory reports a patch at 4.6.6.
Installed Hardhat 3 tooling imports Zod 3 APIs. The registry suggests incompatible
changes or no automatic fix for affected packages. No dependency was silently
forced to a different major API.

The catalogue server imports ethers, not Hardhat/Zod. The development node and
tools still use the affected dependency. Exploit reachability through this node
was not proven or excluded by this assessment. Restrict it to loopback, avoid
untrusted configs/RPC workloads, and track an upstream-compatible toolchain fix.
The exception must be resolved or explicitly reassessed before external access.

Loopback binding is not authentication: other local processes and potentially
malicious browser pages may still reach a development RPC. API Host/Origin checks
do not retrofit those controls onto Hardhat's separate RPC service. This remains
a development-only trust boundary, not a claim that the RPC is hardened for funds.

## 7. Treatment schedule and accountable roles

| Priority / gate | Action and owner | Completion evidence |
| --- | --- | --- |
| P0, this change | Contract maintainer: enforce price cap and bounded pages. Backend maintainer: enforce validation/limits, isolate files, share atomic storage lock. | Build/typecheck and regression commands below pass. Source paths and tests identify each control. |
| P0, local rollout | Project owner: deploy compatible local version, retain previous addresses/credits, restart the API server, verify local origin and file-denial checks. | Running deployment config, successful catalogue GET, protected file returns 403; no old deployment is represented as patched. |
| P1, before any external access | Dependency maintainer: resolve the Zod exception with a compatible upstream stack and rerun the audit/tests. | New lockfile, audit report and full regression results; no unreviewed major override. |
| P1, before any external access | Backend/operations owner: use transactional durable storage with backups, tested restore and capacity monitoring. Add a production HTTP service/gateway; do not expose the Vite dev server or unlocked RPC publicly. | Restore drill on a separate instance; load test at agreed traffic; quotas/timeout alarms documented. |
| P1, before real funds/assets | Contract/security reviewer: independent review and static analysis; exercise multi-actor adversarial lifecycle and economic assumptions. Product owner: define actual ownership/delivery verification and incident authority. | Findings closed or explicitly accepted by the project owner; deployment artifacts verified; contracts and keys reviewed for the target network. |
| P2, each release | Maintainer: rerun tests/audit after dependencies, compiler, RPC, catalogue schema or contract changes. Reassess oracle/flash-loan/proxy categories when those features are introduced. | Updated risk register, evidence and regression record. |

Open Medium risks R07/R09/R11 are accepted **only for the current local demo**
pending project-owner sign-off. They are not accepted for a public service by
this document. Assign named owners and target dates at project planning; the
gates above define the latest safe decision points without inventing delivery promises.

## 8. Verification and security regression plan

Run from the workspace in PowerShell:

```powershell
npx.cmd hardhat build
npx.cmd tsc --noEmit
npx.cmd hardhat test
npm.cmd run test:security
npm.cmd run test:frontend
npm.cmd run test:browser
npm.cmd run build:frontend
npm.cmd audit --json
```

The npm audit currently exits with known findings; this is an open exception,
not a passing zero-vulnerability result. The raw baseline is
`cache/security/npm-audit-before.json` (generated, ignored by Git).

| Test source | Evidence provided |
| --- | --- |
| `contracts/RentalPlatformSecurity.t.sol` | Price boundary/rollback, bounded offsets/pages, enumeration consistency, rent/withdraw solvency fuzzing |
| `contracts/RentalPlatformAssets.t.sol` | Owner authorization, exact-expiry removal, permanent ID reservation |
| `contracts/RentalPlatform.t.sol` | Malicious recipient reentry and failed-transfer recovery |
| `test/RentalPlatform.ts` | Payments, access, durations, simultaneous registrations and withdrawals |
| `frontend/test/server-security.test.mjs` | Host/Origin, malformed JSON/types, MIME/compression, body size/time, rate spoofing, RPC timeout/concurrency, query caps |
| `frontend/test/catalogue-store.test.mjs` | Two independent writer processes, rollback, size cap, corrupt file, bounded lock wait |
| `scripts/test-frontend-browser.js` | Real isolated EVM + simulated wallet; normal flows, hash mismatch rejection, protected file routes, pagination of 56 assets |

Verification at implementation: **45 contract tests and 25 frontend/server tests**
pass, including fuzz runs. Build and typecheck pass. Browser checks use a test
wallet bridge; real MetaMask popup approval remains a manual smoke check.
No independent audit, static-analysis tool, penetration test of public
infrastructure, exhaustive property proof or production load test was performed.

## 9. Monitoring and incident/recovery procedure

Watch 408/413/429/503 responses, `catalogue_unavailable` structured log events,
disk usage approaching 8 MiB, write-lock age and RPC failures. Production needs
centralized metrics and alerts; current console logs alone are not sufficient.

If suspicious behavior is observed:

1. Stop new website/API traffic and preserve logs, the deployment config,
   catalogue file, lock file and transaction hashes. Do not reset the node or
   automatically migrate balances while investigating.
2. Check the configured chain ID/runtime hash and compare relevant registrations,
   removals, payments and withdrawals against on-chain records.
3. If a writer crashed, verify its recorded PID is no longer running and stop
   all writers before an operator backs up data and removes only that store's
   stale `.lock` file. The application never deletes another writer's lock.
4. Restore a verified backup into a separate test instance if data is corrupt.
   Re-validate hashes against the chain before resuming publication.
5. Deploy reviewed remediation if necessary. Preserve old withdrawal access and
   tell users which deployment owns which credits. A frontend shutdown cannot
   pause an immutable on-chain contract.
6. Update the risk register with root cause, affected assets, recovery evidence,
   responsible owner and a regression test before closing the incident.

Backups and lock recovery are operational responsibilities still tracked under
R07. A safe failure is preferable to silently replacing corrupted data or
deleting an active writer's lock.
