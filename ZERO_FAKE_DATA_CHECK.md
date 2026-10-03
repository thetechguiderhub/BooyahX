# ZERO FAKE DATA CHECK — BooyahX

This document records the standing zero-fake-data guarantees of the project and
how they are verified. **Status: VALID** (verified after the Official Team
database-backed assignment change, 2026-10-02).

## Rule

The platform must never contain or display fabricated data:

- no fake users, demo users, or sample users
- no seeded fake team members
- no hardcoded fake team statistics
- no fabricated activity
- no fabricated team assignments
- no localStorage as a source of truth
- no frontend-only authorization

"Empty is better than fake." Any position/user/stat with no real data renders
an honest empty state.

## Official Team (operating/build team — NOT player clans)

Source of truth: the SQLite database (`data/booyahx.db`), tables
`official_team_positions` (position catalog/definitions only) and
`official_team_members` (assignments; `user_id` FK → `users.id`). The frontend
never hardcodes members.

Current real assignments (resolved through the database by email):

| Account (real user)             | Security/RBAC role | Official Team display role |
|---------------------------------|--------------------|-----------------------------|
| itxmeshadow1234@gmail.com       | PRIMARY_OWNER      | Developer                   |
| murtaza12@gmail.com             | OWNER (temporary)  | Owner                       |

`bakihanma123@gmail.com` has **no user account in the database**, so the
Moderator position currently shows **Available**. No account was fabricated for
it. When that real account exists (signup) it can be assigned via
`POST /api/owner/official-team/assign`.

All other positions (Admin, Staff, Support, Tournament Manager, Finance
Manager, Content Manager, Community Manager, Analyst, Others) show **Available**
— meaning: no real account is currently assigned.

## Display role vs security role

The Official Team display role is presentation only. It never replaces or
downgrades the account's RBAC role stored in `roles`/`user_roles`:

- `itxmeshadow1234@gmail.com` → Team display **Developer**, security role
  **PRIMARY_OWNER**, full PRIMARY_OWNER permission authority (`*`) retained and
  protected (cannot be altered by any other account).
- `murtaza12@gmail.com` → Team display **Owner**, security role **OWNER**
  with the existing temporary-owner rules untouched.

## Privacy

The public endpoint `GET /api/official-team` exposes display names/usernames and
security role names only — **no email addresses**. Emails are available only
through the owner console (`GET /api/owner/official-team`, requires
`staff.view`).

## Verification

Run with the server up (`npm start`, or `RATE_LIMIT_DISABLED=true` for the RBAC
matrix):

```bash
node test/official-team.js   # Official Team + zero-fake-data checks
node test/rbac-matrix.js     # 13-role RBAC security matrix
node test/cleanup-artifacts.js && node test/integrity-check.js  # after RBAC matrix
```

`test/official-team.js` asserts:

1. Every `official_team_members` row references a real `users` row (0 orphans).
2. No fake/demo/sample/example accounts exist in `users`.
3. Public payload contains no email addresses.
4. Developer slot = the real PRIMARY_OWNER account (RBAC role unchanged).
5. Owner slot = the real temporary OWNER account (RBAC role unchanged).
6. Unassigned positions report `available: true` (Available).
7. Deactivating an assignment immediately hides the member publicly and does
   **not** touch the account's RBAC role.
8. Primary Owner retains PRIMARY_OWNER authority (sign-in + owner endpoint).

## Payments (added 2026-10-02)

Payment availability is backend-configured (`platform_settings`), never
hardcoded in the frontend, and nothing is ever auto-approved:

| Method   | Deposit | Withdrawal | Notes |
|----------|---------|------------|-------|
| JazzCash | AVAILABLE | AVAILABLE | Real receiving account from settings (`jazzcash_account_name` / `jazzcash_account_number`) |
| Easypaisa | COMING SOON | COMING SOON | Disabled; no account details shown; submissions rejected server-side |
| Bank     | COMING IN 3 DAYS (status text only) | same | Disabled until the owner configures real bank information |

Flows (all real DB records, all audited):

- Deposit: user submits package/coins + transaction reference (+ optional
  proof) → status `PENDING` → Owner/Finance verifies or rejects with a
  mandatory reason. Coins are credited ONLY on verification.
- Withdrawal: server validates auth, minimum (100 coins), sufficient balance,
  no conflicting active request, valid JazzCash destination (account number +
  holder name) → coins RESERVED → record `PENDING`. Rejection restores the
  reserved coins. Completion (`paid`) requires a real payout reference and only
  then finalizes the transaction.

Verify with: `node test/payments-console.js`

## Console switch (added 2026-10-02)

The Primary Owner can switch the interface between Developer Console and Owner
Console (`POST /api/console/switch`). This is a session-scoped interface mode:

- the database RBAC role remains `PRIMARY_OWNER` at all times;
- permissions remain full PRIMARY_OWNER authority in either console;
- only PRIMARY_OWNER may switch (OWNER/MODERATOR/USER get 403);
- every switch is audited (`PRIMARY_OWNER_CONSOLE_SWITCH`, no credentials logged).

## Latest run results

- `test/rbac-matrix.js` → **PASS** (all 13 roles + anonymous, 0 failures)
- `test/smoke.js` → **PASS** (100/100)
- `test/payments-console.js` → **PASS** (all payment + console checks)
- `test/official-team.js` → **PASS**
- `test/integrity-check.js` → no orphaned user references
- `users` table → 3 real accounts only: `primary_owner` (PRIMARY_OWNER),
  `temp_owner` (OWNER), `bakihanma123` (MODERATOR)
- `official_team_members` → Developer / Owner / Moderator slots all reference
  these real users; every other position Available
- `deposits` / `withdrawals` / `transactions` → 0 rows (no fake payment records)
- `wallets` → all real accounts at 0 balance (no fake balances)

## Project status

**NOT READY FOR APK** — unchanged. APK readiness still requires all previously
missing features and end-to-end tests.
