# AWS Architecture: RVAP Digital Catalog

A static-frontend (S3 + CloudFront) / serverless-backend (API Gateway +
Lambda + DynamoDB) library catalog app, originally migrated off a
Next.js + Supabase 2-tier app and seeded from a Google Sheet, optimized
for **minimum monthly cost** (target: $0–3/month, excluding an optional
custom domain — see `DOMAIN_MIGRATION_PLAN.md`).

This document describes the **current architecture as designed**, with a
dated log of what's actually been built and deployed. It replaces an
earlier version of this file that only covered the original Supabase→AWS
migration; that original intent (minimum-cost serverless, no EC2/RDS/VPC,
client-side search, one-time Sheet import) still holds and is preserved
below — everything since has been additive on top of it.

---

## Target Architecture

```
Browser
  │
  ├─▶ CloudFront (OAC) ──▶ S3 (private bucket, static Next.js export)
  │
  └─▶ API Gateway (HTTP API, Cognito JWT authorizer on most routes)
         │
         ├─ GET    /catalog                      → getCatalog         (public)
         ├─ POST   /catalog                       → createItem         (admin)
         ├─ PUT    /catalog/{id}                   → updateItem         (admin)
         ├─ DELETE /catalog/{id}                   → deleteItem         (admin)
         ├─ POST   /catalog/{id}/checkout          → checkoutBook       (auth)
         ├─ POST   /catalog/{id}/return            → returnBook         (auth)
         ├─ POST   /catalog/{id}/request           → requestBook        (auth)
         ├─ POST   /catalog/{id}/notify-holder     → notifyHolder       (admin)
         ├─ GET    /admin/users                    → getUsers           (admin)
         ├─ POST   /admin/users                    → adminCreateUser    (admin)
         └─ PUT    /admin/users/{email}/password   → adminSetPassword   (admin)
                │
                ▼
         DynamoDB (on-demand): Catalog, Checkouts, BookRequests tables

         (not API-routed, EventBridge-scheduled daily)
         sendOverdueReminders, expireHolds

Amazon Cognito User Pool (admin-created users only, custom:admin attribute)
Amazon SES (production access granted — not sandboxed)
```

No EC2, RDS, NAT Gateway, VPC, or OpenSearch/Algolia anywhere in this
design. `GET /catalog` is the one deliberately public route — see
"Public browsing" below; everything else still requires a valid Cognito
JWT, admin-flagged or not depending on the action.

### Why this is cheap
- **S3 + CloudFront**: static assets, pennies/month at low traffic; no
  origin compute cost.
- **Cognito**: free for ≤10,000 monthly active users.
- **API Gateway HTTP API** (not REST API): ~$1/million requests, no fixed
  monthly cost, and its built-in JWT authorizer avoids paying for a Lambda
  authorizer invocation on every request.
- **Lambda**: free tier (1M requests + 400,000 GB-s/month) comfortably
  covers a small library-catalog app. `getCatalog`, `checkoutBook`, and
  `returnBook` are kept warm via a low-frequency EventBridge ping rather
  than Provisioned Concurrency — at one ping every 5 minutes per function
  that's ~26,000 extra invocations/month total, well inside the free
  tier.
- **DynamoDB on-demand**: no provisioned capacity to pay for idle; at
  ~1,700 catalog items and light traffic this is cents/month.
- **No search service**: full-text/fuzzy search runs client-side
  (Fuse.js) over a cached full catalog fetch, avoiding OpenSearch
  (~$700+/mo minimum) or an Algolia subscription entirely.
- **SES**: pay-per-email, no fixed cost; at this volume (checkout/return/
  reminder/admin emails for a single ashrama's membership) effectively
  free.

---

## Data Model (DynamoDB)

### `Catalog` table
- **PK**: `id` (string, ULID) — stable identifier, independent of the
  human-readable display fields.
- **Core attributes**: `title`, `category`, `language` (string array),
  `pubyear` (number, nullable), `firstname`, `lastname`,
  `editedTranslated` (string array, nullable), `number` (sequential
  display id, maintained via an atomic counter item `COUNTER#catalog`
  with `ADD number 1`).
- **`sheetId`** (string, nullable): the original Google Sheet's own `ID`
  column value (e.g. `"668 SMH-H 23.1"`), backfilled after the initial
  migration — see "Sheet ID backfill" below. Shown in the UI as the
  catalog's "ID" column in place of the DynamoDB ULID, which isn't
  meaningful to a librarian.
- **Hold fields** (sparse — only present while a hold is active):
  `holdForUserId`, `holdForUserName`, `holdForUserEmail`,
  `holdExpiresAt`. Set when a requested book is returned (see
  `BookRequests` below) and cleared on checkout or hold expiry.
- `categorycount`/`categoryindex`/`titlecount` are **never stored** —
  computed at read time in `getCatalog.ts` from the full table scan.
- No GSIs. At this item count, `getCatalog` does a full `Scan` and the
  frontend filters/sorts/paginates client-side.

### `Checkouts` table
- **PK**: `bookId` (matches `Catalog.id`).
- **Attributes**: `userId` (Cognito `sub`), `userName`, `userEmail`,
  `userPhone` (denormalized at checkout time — no Cognito admin lookup
  needed per catalog row), `checkedOutAt` (ISO string),
  `lastReminderSentAt` (ISO string, set by the overdue-reminder sweep).
- Checkout = `PutItem` with `ConditionExpression: attribute_not_exists(bookId)`.
- Return = `DeleteItem`, conditioned on `userId` matching the caller
  unless the caller is admin.
- No return history is kept — a return simply deletes the row.

### `BookRequests` table
- **PK**: `bookId`, **SK**: `requesterUserId` — one row per pending "notify
  me when this is returned" request. The composite key both enforces one
  open request per user per book (conditional put) and lets a book's
  whole queue be queried directly, ordered by `requestedAt`.
- **Attributes**: `requesterName`, `requesterEmail`, `requestedAt` (ISO
  string).
- A row is deleted once that requester is promoted to a hold (see below)
  — "served", not left to accumulate.

### Users / admin role
- No DynamoDB `Users` table. Admin flag lives as a Cognito **custom
  attribute** `custom:admin` ("true"/"false"), checked as a free JWT-claim
  read in every Lambda via `requireAdmin()` (`infra/lambda/lib/auth.ts`) —
  enforced server-side on every mutating request, never just trusted from
  the frontend.
- `name`, `email`, `phone_number` for checkout attribution come straight
  from Cognito attributes at checkout time, denormalized into the
  `Checkouts` item.

---

## Public browsing + the request/hold queue

Two significant behavioral layers sit on top of the original CRUD design
above:

### Public browsing (no login required to search/view)
`GET /catalog` has no JWT authorizer attached at the API Gateway level —
anyone can browse and search the catalog without an account, matching the
read-only experience of the comparison site at
`vedanta-pitt.org/library/` (see `DOMAIN_MIGRATION_PLAN.md`). The Lambda
uses `optionalAuth()` instead of `requireAuth()`: if a valid JWT happens
to be present it personalizes the response
(`checkedOutByCurrentUser`/`heldForCurrentUser`/`requestedByCurrentUser`);
if not, those fields just come back `false`. The currently-checked-out
holder's email/phone are redacted from the response unless the caller is
an admin, since that data is no longer behind a universal login wall.

Every mutating action (checkout, return, request, admin edit/delete/
create) still requires the exact same `requireAuth`/`requireAdmin` JWT
check as before — nothing about their server-side enforcement changed.
What's new is purely client-side: an anonymous visitor who clicks one of
these actions sees an inline sign-in modal (`LoginGateModal`) instead of
a bare 401/403, and the action automatically retries once they're signed
in.

### Request/hold queue
A user can request a book that's checked out by someone else. When it's
returned, the earliest-queued requester gets a 48-hour hold placed on the
book (`holdFor*`/`holdExpiresAt` fields on the `Catalog` item) and is
emailed that it's available. `checkoutBook.ts` blocks anyone but the
hold-holder from claiming it until the hold is used or expires. A daily
EventBridge sweep (`expireHolds.ts`) releases unclaimed holds and
promotes the next person in that book's queue, or clears the hold if the
queue is empty. Admins see how many members are waiting on each
checked-out book and can nudge the current holder by email
(`notifyHolder.ts`) without revealing who's waiting.

---

## Lambda inventory

API-routed:

| Handler | Auth | Purpose |
|---|---|---|
| `getCatalog.ts` | public (`optionalAuth`) | Full catalog scan + checkout/hold/request status, personalized if signed in. |
| `createItem.ts` | admin | Create a catalog item. |
| `updateItem.ts` | admin | Update a catalog item by `id`, including `sheetId`. |
| `deleteItem.ts` | admin | Delete a catalog item; also cleans up its `Checkouts` row and any pending `BookRequests` rows. |
| `checkoutBook.ts` | auth | Check out a book; admin can check out on another user's behalf; enforces an active hold. |
| `returnBook.ts` | auth | Return a book; promotes the next queued requester to a hold. |
| `requestBook.ts` | auth | Register interest in a checked-out book. |
| `notifyHolder.ts` | admin | Email the current holder a nudge, without naming the requester. |
| `getUsers.ts` | admin | List all users with their checked-out books and pending-request counts. |
| `adminCreateUser.ts` | admin | Create a Cognito user with an admin-chosen permanent password; sends the welcome email. |
| `adminSetPassword.ts` | admin | Reset an existing user's password; sends the new-credentials email. |

Not API-routed, EventBridge-scheduled (`rate(1 day)`):

| Handler | Purpose |
|---|---|
| `sendOverdueReminders.ts` | Reminds a checkout holder at 3 months, then every 6 months thereafter, until returned. |
| `expireHolds.ts` | Releases/promotes holds that went unclaimed for 48 hours. |

Shared helpers (`infra/lambda/lib/`): `auth.ts` (`requireAuth`/
`requireAdmin`/`optionalAuth`), `dynamo.ts` (table name env vars),
`email.ts` (SES send wrapper, best-effort/non-throwing), `welcomeEmail.ts`
(shared template for new-account and password-reset emails),
`bookRequests.ts` (shared hold-promotion logic used by `returnBook.ts`
and `expireHolds.ts`), `http.ts`/`warmer.ts` (response helpers, warm-pool
ping short-circuit).

`getCatalog`, `checkoutBook`, `returnBook` are kept warm via an
EventBridge ping every 5 minutes (`{ warmerPing: true }`, short-circuited
before any auth/DB call in `warmer.ts`). Every other Lambda is cold-start
tolerant — the frontend shows a "still starting up" hint
(`utils/fetch-with-cold-start-hint.ts`) if a response takes over 400ms.

---

## Auth model

- **No self-service signup.** Accounts are admin-created only
  (`adminCreateUser.ts`) — the Cognito User Pool has
  `selfSignUpEnabled: false`. An admin picks the user's initial password,
  which is sent (along with a short catalog intro, checkout/return
  instructions, and a reminder-email consent notice) in one welcome
  email. The password is permanent immediately — no forced change
  challenge — but the user can change it themselves any time from the
  account menu (`changePassword()` in `utils/cognito/client.ts`).
- **Admin flag**: Cognito custom attribute `custom:admin`, checked
  server-side on every admin-only route.
- **Public vs. authenticated routes**: see "Public browsing" above —
  `GET /catalog` is the sole exception; everything else requires a valid
  JWT.
- **No Cognito Hosted UI** — the app calls Cognito directly via
  `amazon-cognito-identity-js`, so there's no OAuth callback-URL/domain
  binding to maintain if the app's domain changes (see
  `DOMAIN_MIGRATION_PLAN.md`).

---

## Email (SES)

- **Sender identity**: `ramakrishnavedantaashramapitts@gmail.com`,
  verified. **Production access is granted** — SES is no longer in
  sandbox mode, and can send to any recipient (confirmed live via
  `aws sesv2 get-account`, `ProductionAccessEnabled: true`).
- **Emails sent**: welcome/new-account, password-reset, checkout
  confirmation, return confirmation, book-available-with-hold, overdue
  reminder, notify-holder nudge. All go through the shared
  `infra/lambda/lib/email.ts` wrapper — failures are caught and logged,
  never thrown, so a mutating action never fails because SES is down or
  throttled.
- There is no Cognito-triggered email anymore (the old
  `postConfirmation.ts` trigger, tied to self-signup email verification,
  was removed along with self-signup itself).

---

## Frontend

- Next.js static export (`output: 'export'`), deployed to S3 + CloudFront
  with Origin Access Control. A CloudFront Function
  (`RewriteToHtmlFunction`) rewrites extensionless/trailing-slash
  requests to the matching `.html` file, since `next export` writes
  `login.html` rather than `login/index.html`.
- No server-side rendering, no middleware — all data fetching is
  client-side `fetch()` against the API Gateway endpoint, with the
  Cognito ID token (when present) attached as `Authorization: Bearer
  <token>` (`utils/api-client.ts`'s `authedRequestInit()`, which degrades
  gracefully to no header when there's no session).
- Search/filter/sort/pagination run entirely client-side (Fuse.js for
  fuzzy matching) over a single full-catalog fetch — no server-side
  search endpoint.
- `AuthCheck` (a blocking, redirect-on-mount wrapper) has been removed
  from the dashboard and home layouts now that catalog browsing is
  public. `/my-checkouts` and `/admin/users` keep their own lightweight
  session/admin guards, since they show personal or admin-only data.

---

## Current state (as of this writing)

**Deployed and live** (`RvapCognitoStack`, `RvapDataStack`,
`RvapApiStack`, `RvapSiteStack`, region `us-east-2`):
- `Catalog` table: 1,741 items (1,740 catalog rows + 1 counter item).
  `Checkouts` table: 0 items (none currently checked out).
- Lambdas live in the account: `getCatalog`, `checkoutBook`, `returnBook`,
  `createItem`, `updateItem`, `deleteItem`, `getUsers`,
  `adminCreateUser`, `sendOverdueReminders` — this reflects the
  **admin-user-management + overdue-reminders** milestone. SES
  production access is live and verified.

**Committed, not yet deployed:**
- `BookRequests` table, and the `requestBook`/`notifyHolder`/
  `expireHolds`/`adminSetPassword` Lambdas, plus the public (no
  authorizer) `GET /catalog` route and the `sheetId`/hold fields on
  `Catalog` — all described above as current design, but the live
  `RvapDataStack`/`RvapApiStack` predate them. **Deploy via `cdk deploy
  RvapDataStack RvapApiStack` (plus a static-export S3 sync +
  CloudFront invalidation for the matching frontend code) before
  relying on any of: public browsing, book requests/holds, admin
  password reset/set, or the sheet-ID-backed "ID" column showing real
  values instead of "—".**
- The Google Sheet's `sheetId` backfill (`scripts/backfill-sheet-id.ts`)
  **has** already been run against the live `Catalog` table — 1,735 of
  1,740 items matched and were updated in place (5 items — 2 genuinely
  indistinguishable sheet duplicates, 1 catalog-only item, and a few
  Google-Sheet-only rows that were never migrated — remain unmatched and
  show "—"). This part is live; it's the *code* reading/displaying
  `sheetId` that waits on the `RvapApiStack` deploy above.

**Known-still-open:**
- Custom domain — not configured, using CloudFront's default
  `*.cloudfront.net` domain. See `DOMAIN_MIGRATION_PLAN.md` for the
  `vedanta-pitt.org/library/` option.
- No formal end-to-end smoke test has been re-run since the
  public-browsing/book-request changes were deployed (because they
  haven't been deployed yet — do this as part of that deploy).

---

## Notable deviations/fixes from the original migration

- **Lambda runtime**: Node.js 22.x (20.x was originally planned; 22.x was
  current at deploy time).
- **Auth library**: `amazon-cognito-identity-js` directly, not Amplify.
- **Checkout/return key bug** (found and fixed early): `catalog.tsx` was
  passing the book's display `number` instead of its real `id` (ULID) to
  checkout/return handlers, silently breaking checkout-status tracking.
  Fixed by switching all call sites to `order.id`; three pre-existing
  mis-keyed `Checkouts` records were migrated to their correct keys
  rather than deleted.
- **Data model attributes shipped as plain JSON arrays**, not DynamoDB
  string sets (`SS`) — simpler to work with, no functional difference at
  this scale.
- **Self-signup was initially shipped, then removed.** The original
  migration included Cognito self-registration + email verification
  (`app/signup/page.tsx`, a `postConfirmation` Lambda trigger). Both were
  removed in favor of admin-only account creation — see "Auth model"
  above.

---

## Google Sheet migration (one-time, already run)

`scripts/migrate-from-sheet.ts` (service-account auth, read-only scope)
seeded the `Catalog` table once from the sheet (ID
`1F-Jklguj9URpCFhsYbqhFPCL5epI4NPy0wA53zWZU1w`, tab `ALL`): **1,740
catalog items** written, `COUNTER#catalog` seeded to `1740`. This was a
one-time import, not an ongoing sync — all catalog changes since then go
through the app's own admin CRUD UI.

A second one-time script, `scripts/backfill-sheet-id.ts`, was run later
to recover the sheet's own `ID` column (dropped during the original
import) into a new `sheetId` attribute on each matching `Catalog` item —
see "Current state" above for the match results.
