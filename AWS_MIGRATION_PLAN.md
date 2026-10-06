# AWS Architecture: RVAP Digital Catalog

A static-frontend (S3 + CloudFront) / serverless-backend (API Gateway +
Lambda + DynamoDB) library catalog app, originally migrated off a
Next.js + Supabase 2-tier app and seeded from a Google Sheet, optimized
for **minimum monthly cost** (target: $0–3/month, excluding an optional
custom domain — see `DOMAIN_MIGRATION_PLAN.md`).

This document describes the **current architecture as built and
deployed** — every resource and route below is live, not aspirational;
see "Current state" for the live/not-yet-deployed distinction when there
is one. It replaces an earlier version of this file that only covered the
original Supabase→AWS migration; that original intent (minimum-cost
serverless, no EC2/RDS/VPC, client-side search, one-time Sheet import)
still holds and is preserved below — everything since has been additive
on top of it.

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
         ├─ GET    /catalog/{id}/history           → getBookHistory     (admin)
         ├─ GET    /admin/users                    → getUsers           (admin)
         ├─ POST   /admin/users                    → adminCreateUser    (admin)
         ├─ PUT    /admin/users/{email}/password   → adminSetPassword   (admin)
         ├─ PUT    /admin/users/{email}/enabled     → setUserEnabled     (admin)
         └─ DELETE /admin/users/{email}             → deleteUser         (admin)
                │
                ▼
         DynamoDB (on-demand): Catalog, Checkouts, BookRequests, History tables

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
- This table holds only the *current* checkout, if any — no return
  history. The full past-tense record of who held/requested/returned a
  book lives in `History` below.

### `BookRequests` table
- **PK**: `bookId`, **SK**: `requesterUserId` — one row per pending "notify
  me when this is returned" request. The composite key both enforces one
  open request per user per book (conditional put) and lets a book's
  whole queue be queried directly, ordered by `requestedAt`.
- **Attributes**: `requesterName`, `requesterEmail`, `requestedAt` (ISO
  string).
- A row is deleted once that requester is promoted to a hold (see below)
  — "served", not left to accumulate.

### `History` table
- **PK**: `bookId`, **SK**: `eventAt` (ISO timestamp + a `ulid()` suffix,
  so two events in the same millisecond never collide and a book's whole
  history still sorts chronologically via a single `Query`).
- **Attributes**: `eventType` (`checked_out` | `returned` | `requested` |
  `hold_granted` | `hold_expired` | `email_sent`), `userId`, `userName`,
  `userEmail`, and — for `email_sent` events only — `emailSubject`.
- Append-only; nothing is ever deleted or updated here, including after
  the `Catalog`/`Checkouts` rows it describes change or disappear (e.g.
  the book is later removed from the catalog by an admin).
- Written from `checkoutBook.ts`, `returnBook.ts`, `requestBook.ts`,
  `lib/bookRequests.ts` (hold grant), and `expireHolds.ts` (hold expiry) —
  one `recordHistoryEvent()` call per state transition. Every
  book-related email additionally gets a `recordEmailSent()` call (a thin
  wrapper around the same table) at its `sendEmail()` call site, so the
  admin-only History view can show "every email sent for this book" as
  well as "every action taken."
- Read by `getBookHistory.ts` (admin-only), surfaced in the catalog UI's
  History modal (`components/ui/book-history-modal.tsx`) as two sections:
  an action timeline and a separate "Emails sent" list (date, recipient,
  subject).

### Users / admin role
- No DynamoDB `Users` table. Admin flag lives as a Cognito **custom
  attribute** `custom:admin` ("true"/"false"), checked as a free JWT-claim
  read in every Lambda via `requireAdmin()` (`infra/lambda/lib/auth.ts`) —
  enforced server-side on every mutating request, never just trusted from
  the frontend.
- `name`, `email`, `phone_number` for checkout attribution come straight
  from Cognito attributes at checkout time, denormalized into the
  `Checkouts` item.
- **Enabled/disabled**: Cognito's own `Enabled` flag, flipped via
  `setUserEnabled.ts` (`AdminEnableUser`/`AdminDisableUser`). A disabled
  user can't sign in — Cognito rejects the auth attempt directly, no
  app-side check needed — and `lib/email.ts` checks the same flag
  (`AdminGetUser`) before every `sendEmail()` call, so a disabled user
  stops receiving any book- or account-related email too.
- **Deletion**: `deleteUser.ts` only allows deleting a user with zero
  rows in `Checkouts` (verified server-side via a scan) and never an
  admin account. `ipoddar@hotmail.com` is additionally hardcoded as
  undeletable/un-disableable in both Lambdas, independent of its admin
  flag, so there's always at least one reachable admin account.

---

## Public browsing + the request/hold queue

Two significant behavioral layers sit on top of the original CRUD design
above:

### Public browsing (no login required to search/view)
`GET /catalog` has no JWT authorizer attached at the API Gateway level —
anyone can browse and search the catalog without an account, matching the
read-only experience of the comparison site at
`vedanta-pitt.org/library/` (see `DOMAIN_MIGRATION_PLAN.md`). Because API
Gateway never attaches an authorizer context for this route, the Lambda
can't rely on `event.requestContext.authorizer` at all (it's always
`undefined` here, even for a signed-in caller) — `optionalAuth()`
(`infra/lambda/lib/auth.ts`) instead verifies the raw `Authorization:
Bearer <token>` header itself via `aws-jwt-verify`, falling back to
anonymous if there's no token or it's invalid/expired. If verification
succeeds, the response is personalized
(`checkedOutByCurrentUser`/`heldForCurrentUser`/`requestedByCurrentUser`);
if not, those fields come back `false`.

The currently-checked-out holder's name/email/phone (`checkoutDetails`)
are included only for an admin or the holder themselves — any other
member or anonymous visitor just learns a book is unavailable, never from
whom, matching the same privacy bar now that this route has no universal
login wall.

Every mutating action (checkout, return, request, admin edit/delete/
create) still requires the exact same `requireAuth`/`requireAdmin` JWT
check as before — nothing about their server-side enforcement changed.
What's new is purely client-side: an anonymous visitor who clicks one of
these actions sees an inline sign-in modal (`LoginGateModal`) instead of
a bare 401/403, and the action automatically retries once they're signed
in. A top-level "Sign in" nav icon (visible only while signed out) and a
link to the full sign-in page from inside the modal both point back at
`/login` for a visitor who isn't mid-action.

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
| `getBookHistory.ts` | admin | Return a book's full event + email-sent log, newest first. |
| `getUsers.ts` | admin | List all users with their checked-out books, pending-request counts, and enabled status. |
| `adminCreateUser.ts` | admin | Create a Cognito user with an admin-chosen permanent password; sends the welcome email. |
| `adminSetPassword.ts` | admin | Reset an existing user's password; sends the new-credentials email. |
| `setUserEnabled.ts` | admin | Enable/disable a Cognito user; blocks sign-in and all further email. |
| `deleteUser.ts` | admin | Delete a Cognito user, only if they have zero checked-out books and aren't an admin. |

Not API-routed, EventBridge-scheduled (`rate(1 day)`):

| Handler | Purpose |
|---|---|
| `sendOverdueReminders.ts` | Reminds a checkout holder at 3 months, then every 6 months thereafter, until returned. |
| `expireHolds.ts` | Releases/promotes holds that went unclaimed for 48 hours. |

Shared helpers (`infra/lambda/lib/`): `auth.ts` (`requireAuth`/
`requireAdmin`/`optionalAuth`), `dynamo.ts` (table name env vars),
`email.ts` (SES send wrapper — best-effort/non-throwing, and skips any
recipient whose Cognito account is disabled), `welcomeEmail.ts` (shared
template for new-account and password-reset emails), `bookRequests.ts`
(shared hold-promotion logic used by `returnBook.ts` and
`expireHolds.ts`), `history.ts` (`recordHistoryEvent`/`recordEmailSent`/
`getBookHistory` — the `History` table's read/write helpers),
`http.ts`/`warmer.ts` (response helpers, warm-pool ping short-circuit).

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
- **Enabled flag**: Cognito's own `Enabled` attribute, admin-controlled
  via `setUserEnabled.ts` — see "Users / admin role" above.
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
  throttled. The wrapper also silently skips sending (and logs that it
  did) if the recipient's Cognito account is disabled, independent of
  which call site triggered the send.
- Every book-related email is additionally logged as an `email_sent`
  event in the `History` table (see "Data Model" above), visible to
  admins in the catalog's History modal.
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
  search endpoint. The `/home` page's category and language shortcut
  tiles are plain links into this same client-side filter via a `tabs`
  query param (e.g. `/?tabs=S` for Sanskrit).
- `AuthCheck` (a blocking, redirect-on-mount wrapper) has been removed
  from the dashboard and home layouts now that catalog browsing is
  public. `/my-checkouts` and `/admin/users` keep their own lightweight
  session/admin guards, since they show personal or admin-only data.
- S3 objects are synced with explicit `Cache-Control` headers on every
  deploy — `public,max-age=31536000,immutable` for hashed `_next/static/*`
  assets, `no-cache,must-revalidate` for everything else (HTML, `.txt`
  payloads). Without this, browsers fall back to heuristic caching on
  `Last-Modified` and can keep serving a stale JS bundle well after a new
  deploy, which previously caused visible bugs (stale auth-gating logic,
  stale checkout state) for returning visitors until they hard-refreshed.

---

## Current state (as of this writing)

**Deployed and live** (`RvapCognitoStack`, `RvapDataStack`,
`RvapApiStack`, `RvapSiteStack`, region `us-east-2`), confirmed via
`aws dynamodb list-tables`/`scan`, `aws lambda list-functions`, and
`aws sesv2 get-account`:
- Tables: `Catalog` (1,741 items — 1,740 catalog rows + 1 counter item),
  `Checkouts` (0 — nothing currently checked out), `BookRequests` (1
  pending request), `History` (0 — see note below).
- All 14 API-routed Lambdas listed in "Lambda inventory" above are live,
  plus the 2 EventBridge-scheduled ones (`sendOverdueReminders`,
  `expireHolds`). Every route in "Target Architecture" above, including
  the public `GET /catalog`, is live in API Gateway — confirmed with a
  direct unauthenticated `curl` returning `200` with real catalog data
  and a `401` on every other route with no bearer token.
- SES production access is live and verified
  (`ProductionAccessEnabled: true`).
- The Google Sheet's `sheetId` backfill (`scripts/backfill-sheet-id.ts`)
  has been run against the live `Catalog` table — 1,735 of 1,740 items
  matched and were updated in place (5 items — 2 genuinely
  indistinguishable sheet duplicates, 1 catalog-only item, and a few
  Google-Sheet-only rows that were never migrated — remain unmatched and
  show "—" for their `sheetId`/"ID" column).

**Known-still-open:**
- Custom domain — not configured, using CloudFront's default
  `*.cloudfront.net` domain. See `DOMAIN_MIGRATION_PLAN.md` for the
  `catalog.vedanta-pitt.org` subdomain plan (ACM cert + GoDaddy DNS
  CNAME) — not yet requested or executed.
- The `History` table is empty as of this writing not because it's
  undeployed (it is deployed and wired into every write path above) but
  because no checkout/return/request/email has happened against the live
  catalog since it was added — it will start filling in from the next
  real checkout onward. No backfill of pre-existing activity exists or
  is planned, since there was nowhere to record it before this table
  existed.
- Email deliverability for the `ramakrishnavedantaashramapitts@gmail.com`
  sender identity has not been hardened with its own domain's SPF/DKIM —
  SES's DKIM signing is currently disabled for this identity
  (`DkimAttributes.SigningEnabled: false`), which risks spam-folder
  placement, especially for Gmail-to-Gmail delivery. Verifying a
  domain-based sender identity (e.g. a subdomain of `vedanta-pitt.org`)
  with DKIM enabled would fix this, but hasn't been done.

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
- **`optionalAuth()` initially trusted API Gateway's authorizer context
  on the public `GET /catalog` route, then had to be rewritten.** Because
  that route deliberately has no authorizer attached, API Gateway never
  populates `event.requestContext.authorizer` for it — the original
  implementation read from it anyway, so `sub` came back `undefined` for
  every caller, signed in or not. This broke `checkedOutByCurrentUser`
  (and, briefly, a separate bug in the same comparison made it `true` for
  anonymous visitors on every unchecked-out book instead of `false`).
  Fixed by having `optionalAuth()` verify the raw bearer token itself via
  `aws-jwt-verify` instead of relying on an authorizer context that only
  exists on authenticated routes.
- **S3 deploys initially shipped with no `Cache-Control` headers**,
  which let browsers heuristically cache stale HTML/JS past a new
  deploy — see "Frontend" above for the fix.

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
