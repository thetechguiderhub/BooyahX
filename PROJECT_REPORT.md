# BOOYAHX — PROJECT REPORT

_Date: 2026-10-02 · Scope: Payment methods (deposit/withdraw), owner payment management, Primary Owner console switch._

## IMPLEMENTED

- **Deposit methods (exactly 3, backend-configured):**
  - **JazzCash — AVAILABLE.** Real receiving account served from the backend
    (`Rubina Imran — 0322 4936337`). Player selects JazzCash, sees the account
    details, sends payment externally, then submits amount/package, transaction
    reference ID and optional proof. Record starts `PENDING`.
  - **Easypaisa — COMING SOON.** Disabled server-side and in UI; no account
    details shown; submissions rejected with a clear error.
  - **Bank — "Coming in 3 days" (status text only).** Disabled until the owner
    configures real bank information. Nothing auto-enables on a timer.
- **Withdrawal methods (same 3).** JazzCash available with full server
  validation; Easypaisa/Bank disabled with honest status messages.
- **Withdrawal lifecycle:** available balance → **reserve coins** → `PENDING`
  record → owner approves (`approved`/`processing`) → **completed only after
  the owner records the real payout** (payout reference mandatory). Rejection
  (reason mandatory) restores reserved coins. Nothing is ever claimed "paid"
  unless the payout was actually recorded.
- **Owner/Finance payment management** wired end-to-end (see FRONTEND).
- **Primary Owner console switch** (Developer ↔ Owner) — session-scoped
  interface mode; RBAC role never changes; fully audited.
- **Official Team** (previous milestone) remains intact and DB-backed.

## API ENDPOINTS

New:
- `GET  /api/payment-methods` — public; deposit/withdraw availability + status
  messages + JazzCash receiving account (only when enabled). No secrets.
- `GET  /api/console` — current console mode + `can_switch` (PRIMARY_OWNER only).
- `POST /api/console/switch` — switch `OWNER`/`DEVELOPER`; PRIMARY_OWNER-only;
  audited (`PRIMARY_OWNER_CONSOLE_SWITCH`).

Changed:
- `POST /api/deposits` — method availability now read from settings; disabled
  methods rejected server-side.
- `POST /api/withdrawals` — same, plus JazzCash destination validation
  (account number 10–15 digits + holder name) and existing checks
  (auth, min 100 coins, sufficient balance, one active request).
- `POST /api/deposits/:id/reject`, `POST /api/withdrawals/:id/reject` —
  rejection reason now **required**.
- `POST /api/withdrawals/:id/approve` — `to=paid` requires a real
  `payout_reference`; stores it on the withdrawal and audit record.
- `GET /api/wallet` — now reports `reserved_coins`.
- `GET /api/withdrawals` — now reports global `reserved_coins`.
- `GET /api/auth/me`, `POST /api/auth/signin` — include session `console_mode`.

## DATABASE

- `deposits` / `withdrawals`: `payment_method` CHECK relaxed to include
  `'bank'` via safe in-place table rebuild (data preserved; indexes recreated).
- `withdrawals.payout_reference` column added (migration).
- `platform_settings` seeds (INSERT OR IGNORE, owner-editable):
  `deposit_jazzcash_enabled=true`, `deposit_easypaisa_enabled=false`,
  `deposit_bank_enabled=false`, `withdraw_*` equivalents,
  `jazzcash_account_name`, `jazzcash_account_number`,
  `easypaisa_status_message`, `bank_status_message`.
- Console mode deliberately **NOT** stored as a user role — it lives in the
  express session only.

## RBAC

- Unchanged and verified: `roles` / `permissions` / `role_permissions` /
  `user_roles` drive every guard; PRIMARY_OWNER/OWNER hold `*`.
- PRIMARY_OWNER protection intact (account + role cannot be touched by others).
- Console mode is UI-only; every sensitive endpoint still enforces
  `requirePermission`/`requireRole` server-side.
- `POST /api/console/switch` requires the PRIMARY_OWNER **role** — OWNER,
  MODERATOR and USER are denied (403).

## PAYMENTS

- Availability: config-driven (`platform_settings`) via `methodStatus()`.
- Deposits: never auto-approved; `PENDING` until staff verifies.
- Withdrawals: reserve → pending → approve → completed-with-payout-reference;
  reject restores reserved coins via an idempotent `refund` transaction.
- Every submit/verify/reject/approve/payout action writes an `audit_logs` row.
- No payment credentials/secrets in frontend source (account name/number are
  public receiving details served from the backend).

## CONSOLE SWITCH

- UI: `CURRENT CONSOLE` select in the owner sidebar (all pages) and a polished
  switcher panel on the dashboard. Switch happens without logout; the sidebar
  re-renders immediately; pages outside the new workspace redirect to the
  dashboard.
- Server: session-stored `consoleMode` (`OWNER`|`DEVELOPER`), validated
  server-side, PRIMARY_OWNER-only, audited with previous/new console, IP and
  user agent (no credentials).
- Navigation filters by console **and** permission; backend authorization is
  never relaxed by console mode.

## FRONTEND

- [wallet.html](wallet.html): real wallet — balance + reserved coins, backend
  package list, 3 method cards (only enabled ones interactive), JazzCash
  deposit form (reference/proof), JazzCash withdrawal form (account number +
  holder name), my deposits/withdrawals, transaction history. All from the API.
- [owner/deposits.html](owner/deposits.html): wired table — status tabs,
  search, reference ID, proof, Verify/Reject with mandatory reason modal.
- [owner/withdrawals.html](owner/withdrawals.html): wired table — status tabs,
  destination details, payout reference column, reserved-coins summary,
  Approve / Reject(reason) / **Record Payout** (reference required).
- [owner/dashboard.html](owner/dashboard.html) + [js/owner-auth.js](js/owner-auth.js):
  console switcher + console-filtered navigation.
- Truthful empty states everywhere; unimplemented features show
  `NOT CONFIGURED` / `NOT IMPLEMENTED`-style honest states.

## SECURITY

- Server-side validation for all payment inputs; idempotency keys on wallet
  changes; atomic reserve/restore inside transactions.
- Session-based console mode; invalid values rejected; only PRIMARY_OWNER can
  switch; console never overrides role/permissions.
- Rejection reasons mandatory (both deposits and withdrawals); payout reference
  mandatory for completion.
- No secrets in frontend; public payment endpoint exposes only the receiving
  account name/number.

## TEST RESULTS

| Suite | Result |
|---|---|
| `test/payments-console.js` (new — 53 checks: methods config, deposit pending/no auto-approve, disabled methods, min/balance/duplicate/destination validation, reserve/restore/payout lifecycle, audit, console switch matrix, RBAC invariants) | **PASS** |
| `test/smoke.js` | **PASS** (100/100) |
| `test/rbac-matrix.js` (13 roles + anonymous) | **PASS** (0 failures) |
| `test/official-team.js` | **PASS** |
| `test/cleanup-artifacts.js` + `test/integrity-check.js` | **PASS** (no orphaned references) |

## ZERO FAKE DATA

Confirmed after implementation (see [ZERO_FAKE_DATA_CHECK.md](ZERO_FAKE_DATA_CHECK.md)):

- no fake/demo/sample users (3 real accounts only)
- 0 deposits, 0 withdrawals, 0 transactions in the DB — no fake payment records
- no fake balances (all real wallets at 0)
- no fake team members (Developer/Owner/Moderator slots reference real users)
- no fake console permissions; no localStorage as source of truth
- test-created records are cleaned up by the suites themselves

## NOT CONFIGURED

- **Easypaisa** — disabled (`*_easypaisa_enabled=false`) until the owner
  configures it. Shows "Coming Soon".
- **Bank** — disabled (`*_bank_enabled=false`) until the owner adds real bank
  details. Shows "Coming in 3 days" (status text only; no timer-based enable).
- Automatic payment gateway integration (live JazzCash API) — not implemented;
  flow is manual-review by design.
- Owner **Settings UI** fields for the new payment keys exist in the backend
  allow-list; a dedicated payments settings panel can be added later.

## FAILURES

None outstanding. All suites pass. (During development one seeded setting had
a typo in the account number — fixed and verified.)

## APK STATUS

**NOT READY FOR APK.**

This milestone (payments + console switch) does not by itself make the project
APP/APK ready. APK readiness still requires all previously missing features and
the complete end-to-end backend/frontend/security test suite to pass.
