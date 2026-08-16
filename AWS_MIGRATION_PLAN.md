# AWS Migration Plan: RVAP Digital Catalog

Migrate the current Next.js + Supabase 2-tier app to a static-frontend
(S3 + CloudFront) / serverless-backend (API Gateway + Lambda + DynamoDB)
architecture on AWS, seeded from an existing Google Sheet, optimized for
**minimum monthly cost** (target: $0–3/month, excluding an optional custom
domain).

This plan assumes a fresh read of the codebase confirmed:
- No `app/api` routes; all backend logic lives in Server Components,
  Server Actions (`app/(dashboard)/actions.ts`), and `middleware.ts`.
- Supabase Postgres tables: `catalog`, `checkouts`, `users`/`profiles`
  (admin flag drift between the two — needs reconciling), plus Supabase
  managed `auth.users`.
- `sql/search_catalog_function.sql` is **empty** — the real `search_catalog`
  Postgres RPC body must be pulled from the live Supabase project (dashboard
  or `supabase db dump`) before search logic can be ported, or simply
  reimplemented client-side (this plan chooses the latter — see Phase 3).
- No file/image storage is actually used anywhere despite leftover
  `next.config.ts` remote-pattern config — no S3 data bucket needed beyond
  hosting the static site.
- `drizzle-orm`, `@neondatabase/serverless`, `@vercel/analytics`, and the
  stale `README.md`/`error.tsx` Vercel-Postgres snippet are dead template
  leftovers — remove during cleanup, not part of runtime architecture.

Decisions already made (do not re-litigate unless requirements change):
- **Frontend**: keep the existing Next.js codebase, convert to a static
  export (`output: 'export'`), deploy to S3 + CloudFront. Do not rewrite as
  a separate Vite/React SPA.
- **Google Sheet**: one-time seed import into DynamoDB. Not an ongoing
  sync — after seeding, all catalog changes happen through the app's own
  admin CRUD UI backed by DynamoDB.

---

## Target Architecture

```
Browser
  │
  ├─▶ CloudFront (OAC) ──▶ S3 (private bucket, static Next.js export)
  │
  └─▶ API Gateway (HTTP API, Cognito JWT authorizer)
         │
         ├─ GET  /catalog                → Lambda getCatalog
         ├─ POST /catalog                → Lambda createItem      (admin)
         ├─ PUT  /catalog/{id}           → Lambda updateItem      (admin)
         ├─ DELETE /catalog/{id}         → Lambda deleteItem      (admin)
         ├─ POST /catalog/{id}/checkout  → Lambda checkoutBook    (auth)
         └─ POST /catalog/{id}/return    → Lambda returnBook      (auth)
                │
                ▼
         DynamoDB (on-demand): Catalog table, Checkouts table

Amazon Cognito User Pool (email/password, verification email, custom:admin attribute)
```

No EC2, RDS, NAT Gateway, VPC, or OpenSearch/Algolia anywhere in this design.

### Why this is cheap
- **S3 + CloudFront**: static assets, pennies/month at low traffic; no
  origin compute cost.
- **Cognito**: free for ≤10,000 monthly active users.
- **API Gateway HTTP API** (not REST API): ~$1/million requests, no fixed
  monthly cost, and its built-in JWT authorizer avoids paying for a Lambda
  authorizer invocation on every request.
- **Lambda**: free tier (1M requests + 400,000 GB-s/month) comfortably
  covers a small library-catalog app. `getCatalog`, `checkoutBook`, and
  `returnBook` are kept warm via a low-frequency EventBridge ping (see
  Phase 1) rather than Provisioned Concurrency — at one ping every 5
  minutes per function that's ~26,000 extra invocations/month total,
  well inside the free tier, so warming these three costs effectively
  $0 instead of the ~$1.50–2/month per function Provisioned Concurrency
  would add.
- **DynamoDB on-demand**: no provisioned capacity to pay for idle; at
  ~2,000 catalog items and light traffic this is cents/month.
- **No search service**: at ~2,000 rows, full-text/fuzzy search runs
  client-side (Fuse.js) over a cached full catalog fetch, avoiding
  OpenSearch (~$700+/mo minimum) or Algolia subscription costs entirely.

---

## Data Model (DynamoDB)

### `Catalog` table
- **PK**: `id` (string) — a new stable identifier (ULID or zero-padded
  numeric string), replacing the current fragile derived composite string
  (`"{number} {category}-{lang} {idx}.{count}"`) used as a pseudo-PK today.
  The human-readable "number"/category/index formatting becomes a
  **display-only derived field**, computed at read time or stored
  redundantly but never used as a lookup key.
- **Attributes**: `title`, `category` (string), `language` (string set,
  `SS`), `pubyear` (number, nullable), `firstname`, `lastname`,
  `editedTranslated` (string set, nullable).
- Drop the `titlecount`/`categorycount`/`categoryindex` recompute-on-write
  pattern (was already a race condition on Postgres via
  `SELECT MAX()`/`COUNT()` with no locking). If category/title numbering
  display is still wanted, compute it in the `getCatalog` Lambda from a
  full table scan result (cheap at 2,000 items) rather than storing and
  maintaining redundant counters.
- **`number` (sequential display id)**: maintain via a single atomic
  counter item (`PK = "COUNTER#catalog"`) updated with `UpdateItem`
  `ADD number 1` — avoids the current unguarded `MAX()+1` race.
- No GSIs initially. At 2,000 items, `getCatalog` does a full `Scan` and
  the frontend filters/sorts/paginates client-side (matches current fuzzy
  search UX, see Phase 3). Add a GSI on `category` only if item count grows
  enough that a full scan becomes a real cost/latency concern (unlikely for
  a single ashrama's library).

### `Checkouts` table
- **PK**: `bookId` (string, matches `Catalog.id`).
- **Attributes**: `userId` (Cognito `sub`), `userName`, `userEmail`,
  `userPhone` (denormalized at checkout time so `getCatalog` doesn't need a
  Cognito admin lookup per row — this replaces today's
  `supabase.auth.admin.listUsers()` call, which needs a service-role key
  not currently present as an env var anywhere in the repo and should not
  be replicated), `checkedOutAt` (ISO string).
- Checkout = `PutItem` with condition `attribute_not_exists(bookId)` —
  atomic, fixes the current read-then-write race in
  `app/(dashboard)/actions.ts`.
- Return = `DeleteItem` (with a condition that `userId` matches the
  caller, unless the caller is admin, to prevent returning someone else's
  checkout).
- No separate "returned" history is kept (matches current behavior — old
  `returned_at IS NOT NULL` rows aren't surfaced in the UI); if a return
  history is wanted later, write a copy to a `CheckoutHistory` table on
  delete rather than soft-deleting.

### Users / admin role
- No DynamoDB `Users` table needed. Admin flag lives as a Cognito
  **custom attribute** `custom:admin` ("true"/"false") on the user pool,
  set via `AdminUpdateUserAttributes` (console or a one-off script for the
  initial admin user). This collapses the current three-way drift
  (`app_metadata`/`user_metadata`/`users` table/`profiles` table) into one
  source of truth, and makes admin checks a **free JWT-claim read** in
  every Lambda (no DB call), while still being enforced server-side per
  request (matches the current defense-in-depth pattern in
  `actions.ts` — keep re-checking the claim inside every mutating Lambda,
  not just trusting the frontend).
- `full_name`, `email`, `phone_number` used for checkout attribution come
  straight from Cognito standard/custom attributes at checkout time
  (denormalized into the `Checkouts` item as above).

---

## Phase 1 — AWS foundational resources (IaC)

Use **AWS CDK (TypeScript)** for all infra — keeps the whole repo in one
language, easy to iterate, no separate Terraform toolchain to install.

1. New top-level `infra/` directory, CDK app (`cdk init app --language typescript`).
2. **Cognito** stack:
   - User Pool: email/password sign-in, required email verification,
     self-registration enabled, standard attributes `email`, `name`,
     `phone_number`; custom attribute `custom:admin` (string, mutable).
   - User Pool Client: no client secret (SPA/public client), auth flows
     `ALLOW_USER_PASSWORD_AUTH` + `ALLOW_REFRESH_TOKEN_AUTH`.
   - (No Hosted UI needed — the existing login/signup pages can call
     Cognito directly via the JS SDK, preserving the current custom
     login/signup UI instead of redirecting to a hosted domain.)
3. **DynamoDB** stack: `Catalog` and `Checkouts` tables as above, billing
   mode `PAY_PER_REQUEST`.
4. **Lambda + API Gateway** stack:
   - One Lambda per operation (Node.js 20.x runtime, esbuild bundling via
     CDK `NodejsFunction` — no separate build step to maintain).
   - HTTP API (`aws-cdk-lib/aws-apigatewayv2`) with a
     `HttpJwtAuthorizer` pointed at the Cognito User Pool's JWKS endpoint.
   - Routes attach authorizer where needed (all routes require auth except
     none — even reads require login, matching today's app-wide
     `middleware.ts` gate).
   - Grant each Lambda least-privilege DynamoDB IAM permissions
     (`grantReadData`/`grantReadWriteData` scoped per table per function).
   - **Warm pool for the hot-path Lambdas** (`getCatalog`, `checkoutBook`,
     `returnBook`): an EventBridge scheduled rule (`rate(5 minutes)`)
     targets each of these three functions directly with a static JSON
     payload `{ "warmerPing": true }`. Each handler checks for
     `event.warmerPing` **first, before touching DynamoDB or running any
     auth/admin check**, and returns immediately
     (`{ statusCode: 200, body: "warm" }`) — critical for `checkoutBook`/
     `returnBook` so a warming ping can never accidentally check out or
     return a book. This keeps one execution environment per function
     warm continuously; a burst of concurrent traffic can still cold-start
     *additional* environments beyond the one kept warm, so this reduces
     — but doesn't eliminate — cold starts under concurrency. No
     Provisioned Concurrency is used (it bills hourly even at 1 unit,
     conflicting with the plan's minimum-cost target); the EventBridge
     ping costs effectively nothing at this traffic volume.
   - `createItem`, `updateItem`, `deleteItem` (admin-only, low-frequency)
     are **not** kept warm — see the cold-start loading message in
     Phase 3 instead.
5. **S3 + CloudFront** stack:
   - Private S3 bucket (block all public access), CloudFront distribution
     with Origin Access Control, default root object `index.html`, a
     custom error response mapping 403/404 → `/index.html` (200) to support
     client-side routing.
   - Optional: ACM cert + Route 53 record if a custom domain is wanted
     (skip for pure minimum-cost — CloudFront's default `*.cloudfront.net`
     domain works fine and is free).
6. Output the API Gateway endpoint URL and Cognito User Pool
   ID/Client ID from the CDK stack — these become the frontend's env vars.

---

## Phase 2 — Backend Lambdas (replace `lib/db.ts` + `actions.ts`)

Create `infra/lambda/` (or a top-level `backend/` dir referenced by CDK)
with one handler file per operation, using the AWS SDK v3 DynamoDB
document client.

| Handler | Replaces | Behavior |
|---|---|---|
| `getCatalog.ts` | `lib/db.ts` `getData()` | `Scan` the `Catalog` table (paginate internally if `Scan` needs multiple pages), `Scan`/`BatchGet` the `Checkouts` table, merge checkout info into each catalog item, return full JSON array. No server-side filter/paginate/search — client does it (Phase 3). |
| `createItem.ts` | `actions.ts` `createProduct` + `lib/db.ts` `createProduct` | Verify `custom:admin` claim from the JWT (via API Gateway's authorizer context, `event.requestContext.authorizer.jwt.claims`). Atomic-increment the `number` counter item. Write new `Catalog` item with a generated `id` (ULID). |
| `updateItem.ts` | `actions.ts` `updateProduct` + `lib/db.ts` `updateProductById` | Admin check. `UpdateItem` on `Catalog` by stable `id` — no more regenerating the PK on edit. |
| `deleteItem.ts` | `actions.ts` `deleteProduct` + `lib/db.ts` `deleteProductById` | Admin check. `DeleteItem` on `Catalog`; also delete any associated `Checkouts` item for that `bookId`. |
| `checkoutBook.ts` | `actions.ts` `checkoutBook` | Auth check (any logged-in user). `PutItem` on `Checkouts` with `ConditionExpression: attribute_not_exists(bookId)` — returns a clean 409 conflict if already checked out (replaces today's read-then-write check). |
| `returnBook.ts` | `actions.ts` `returnBook` | Auth check. `DeleteItem` on `Checkouts` with `ConditionExpression` that `userId = :callerSub OR` caller has `custom:admin = true` (checked in code, since DynamoDB conditions can't branch on IAM role — fetch the item first only to decide branch logic if needed, or pass an admin bypass flag from the verified JWT claim). |

Notes:
- Every Lambda re-verifies the admin/auth claim itself (from the API
  Gateway JWT authorizer's `requestContext.authorizer.jwt.claims`), not
  just trusting the frontend — preserves the current defense-in-depth
  pattern.
- No Lambda needs `supabase.auth.admin.listUsers()`-equivalent calls,
  because checkout attribution is denormalized into the `Checkouts` item
  at write time (see data model above) — avoids needing Cognito
  `AdminGetUser`/`ListUsers` IAM permissions in the hot read path.

---

## Phase 3 — Frontend changes

1. **`next.config.ts`**: add `output: 'export'`, set `images.unoptimized:
   true` (or drop `next/image` usage entirely — confirm no page still
   uses it after the removal of the two unused remote-pattern entries,
   which reference features nothing in the app actually uses).
2. **Remove Next.js server-only constructs**:
   - Delete `middleware.ts`. Replace its route-guard behavior with a
     client-side `AuthGate` component (extend/replace the existing
     but currently-unwired `components/auth-check.tsx`) that:
     - reads the current Cognito session (Amplify Auth or raw
       `amazon-cognito-identity-js`),
     - redirects to `/login` if absent,
     - redirects to `/verify-email` if the session's email isn't verified,
     - redirects away from `/login`/`/signup` if already authenticated.
   - Convert `app/(dashboard)/page.tsx` from an `async` Server Component
     doing SSR data-fetch to a client component that calls
     `GET {API_URL}/catalog` on mount (or in a small server-exported
     shell + client fetch, since static export has no server at request
     time).
   - Convert `app/(dashboard)/actions.ts` Server Actions into plain client
     `fetch()` calls to the corresponding API Gateway routes, passing the
     Cognito ID token in an `Authorization: Bearer <token>` header. Update
     all call sites in `catalog.tsx`/`products-page-client.tsx` /
     create/edit/delete modal components accordingly (they likely already
     just call the imported action function — swap the import for a
     `fetch` wrapper with the same call signature to minimize UI-layer
     diff).
3. **Auth SDK swap**: replace `utils/supabase/client.ts` and
   `utils/supabase/server.ts` with a single `utils/cognito/client.ts`
   wrapping Amplify Auth (`aws-amplify/auth`) or `amazon-cognito-identity-js`
   directly (lighter weight, no need for the full Amplify library if only
   auth is used). Update:
   - `app/login/page.tsx` — call Cognito `signIn` instead of
     `supabase.auth.signInWithPassword`.
   - `app/signup/page.tsx` — call Cognito `signUp` with `custom:admin`
     defaulted to `"false"`, `phone_number`/`name` as standard/custom
     attributes instead of `user_metadata`.
   - `app/verify-email/page.tsx` — Cognito verification is code-based by
     default (6-digit code emailed, confirmed via `confirmSignUp`) rather
     than Supabase's link-with-token-in-URL-hash flow — this page's logic
     changes from parsing `access_token`/`refresh_token` out of the URL to
     a simple code-entry form.
   - `components/sign-out-button.tsx` — call Cognito `signOut`.
   - `components/auth-check.tsx` — becomes the real, wired-in route guard
     (see above) instead of vestigial.
4. **Search/filter/pagination** (`components/catalog/catalog.tsx`,
   `search.tsx`): fetch the full catalog once on load, cache in
   component/query state, and run filtering (category, language,
   pubyear range, title/author/id fuzzy match) and pagination entirely
   client-side using **Fuse.js** for the fuzzy-match piece that the
   missing `search_catalog` Postgres RPC used to provide server-side. This
   removes the dependency on recovering that missing SQL function
   entirely — functionally equivalent UX at zero infra cost.
5. **Env vars**: replace `NEXT_PUBLIC_SUPABASE_URL` /
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` with `NEXT_PUBLIC_API_URL`,
   `NEXT_PUBLIC_COGNITO_USER_POOL_ID`, `NEXT_PUBLIC_COGNITO_CLIENT_ID`
   (all safe to expose client-side, same trust model as the current
   Supabase anon key).
6. **Cleanup**: remove now-unused deps from `package.json` —
   `@supabase/ssr`, `@supabase/supabase-js`, `drizzle-orm`, `drizzle-kit`,
   `drizzle-zod`, `@neondatabase/serverless`, `@vercel/analytics`. Add
   `amazon-cognito-identity-js` (or `aws-amplify`), `fuse.js`,
   `aws-sdk`/`@aws-sdk/client-dynamodb` (only needed in the Lambda/infra
   package, not the frontend bundle — keep it out of the root
   `package.json` if the frontend and infra aren't sharing one
   `node_modules`). Delete the stale template leftovers: `README.md`
   Vercel-Postgres content, `app/(dashboard)/error.tsx`'s
   `CREATE TABLE users...` snippet, `sql/search_catalog_function.sql`
   (empty, superseded by client-side search).

---

## Phase 4 — Data migration from Google Sheet

One-off Node.js script, not a deployed service (run locally or as a
throwaway CDK custom-resource / manual `ts-node` invocation once).

1. `scripts/migrate-from-sheet.ts`:
   - Auth to Google Sheets API using a service account (read-only scope,
     `https://www.googleapis.com/auth/spreadsheets.readonly`) — service
     account JSON key kept out of git, passed via env var/local file, not
     committed.
   - Read all rows via `sheets.spreadsheets.values.get`.
   - Map sheet columns → `Catalog` item shape (title, category, language
     list, pubyear, author names, editedTranslated flags) — column mapping
     needs confirming against the actual sheet's headers before writing
     the transform.
   - Generate stable `id` (ULID) per row; compute/track `number` via the
     same counter-item pattern the app uses at runtime, seeded to the
     final count so future admin-created items continue the sequence
     correctly.
   - Write in batches of 25 via `BatchWriteItem` (DynamoDB's batch limit),
     with basic retry/backoff on `UnprocessedItems`.
2. Run once against the deployed `Catalog` table before go-live. Verify
   row count and a spot-check of a few records via the AWS console or a
   `Scan` before cutting over DNS/pointing users at the new frontend.
3. Do not build this into a recurring sync (per the one-time-import
   decision) — after this run, the Google Sheet is no longer the source
   of truth; all further catalog changes go through the app's admin
   CRUD UI against DynamoDB.

---

## Phase 5 — Cutover

1. Deploy CDK stacks (`cdk deploy --all`).
2. Run the migration script against the live `Catalog` table.
3. Manually promote the first admin user: sign up normally through the
   new app, then use `AdminUpdateUserAttributes` (AWS CLI or console) to
   set `custom:admin = "true"` on that user (no UI needed for this
   one-time bootstrap step).
4. Build the static export (`next build`, verify `out/` directory) and
   sync to S3 (`aws s3 sync out/ s3://<bucket> --delete`), then invalidate
   the CloudFront distribution's cache (`aws cloudfront
   create-invalidation`).
5. Smoke-test: sign up, verify email, log in, browse/search/filter
   catalog, check out a book as one user, confirm a second user sees it as
   unavailable, admin create/edit/delete an item, sign out.
6. Decommission the Supabase project only after the above is confirmed
   stable (keep it around briefly as a rollback fallback / data-recovery
   reference given the missing `search_catalog` SQL and admin-flag
   drift noted above).

---

## Open items to confirm before/during implementation

- Confirm actual Google Sheet column headers/layout against the `Catalog`
  field mapping in Phase 4 — not yet inspected.
- Decide whether `editedTranslated`/`rev` (the latter appears unused in
  current insert/update code, possibly vestigial) need to carry over at
  all — check with the ashrama librarian/admin if `rev` means anything to
  them before dropping it silently.
- Confirm whether `supabase.auth.admin.listUsers()` (needs a service-role
  key not found in this repo's env vars) is actually working in the
  current production deployment — if it's silently failing today, that's
  a pre-existing bug independent of this migration, not a regression to
  worry about matching.
- Decide on a custom domain (adds Route 53 + ACM, still cheap but not
  strictly $0) vs. the default CloudFront domain.

---

## As Executed

The migration above has been carried out. All four CDK stacks are
deployed and live in the target AWS account, region `us-east-2`:

| Stack | File | Status |
|---|---|---|
| `RvapCognitoStack` | `infra/lib/cognito-stack.ts` | CREATE_COMPLETE |
| `RvapDataStack` | `infra/lib/data-stack.ts` | CREATE_COMPLETE |
| `RvapApiStack` | `infra/lib/api-stack.ts` | UPDATE_COMPLETE |
| `RvapSiteStack` | `infra/lib/site-stack.ts` | UPDATE_COMPLETE |

Live endpoints/identifiers (redacted here — see CDK stack outputs or
`.env.production.local` for actual values):
- API Gateway: `<ApiStack ApiUrl output>`
- Cognito User Pool / App Client: `<CognitoStack CognitoUserPoolId /
  CognitoUserPoolClientId outputs>`
- CloudFront / S3: `<SiteStack DistributionDomainName / BucketName
  outputs>`
- DynamoDB: `RvapDataStack-CatalogTable*`, `RvapDataStack-CheckoutsTable*`

### Deviations from the plan above
- **Lambda runtime**: shipped as **Node.js 22.x**, not the planned 20.x
  (22.x was current at deploy time).
- **CloudFront routing gotcha not in the original plan**: `next export`
  writes routes as `login.html` rather than `login/index.html`, so a bare
  `/login` request would 404 through to the SPA fallback and silently
  serve the wrong page. Fixed with a CloudFront Function
  (`RewriteToHtmlFunction`, JS 2.0 runtime, added in
  `infra/lib/site-stack.ts`) on `viewer-request` that appends
  `index.html` to trailing-slash URIs and `.html` to extensionless ones
  before the request reaches S3.
- **Auth library**: went with `amazon-cognito-identity-js` directly
  (the plan's "lighter weight" alternative), not Amplify.
- **Cold-start UX was fully wired, not just described**: the warm-pool
  design shipped as planned (EventBridge → `isWarmerPing()` short-circuit
  in `infra/lambda/lib/warmer.ts`), plus an `X-Lambda-Warm` response
  header (`infra/lambda/lib/http.ts`) that the frontend
  (`utils/fetch-with-cold-start-hint.ts`, consumed by
  `app/(dashboard)/actions.ts`'s `adminRequest()`) uses to show a
  "still starting up" hint for the three unwarmed admin-mutation Lambdas
  if a response takes over 400ms.
- **Data model attributes shipped as plain arrays**, not DynamoDB string
  sets (`SS`) as originally suggested for `language`/`editedTranslated` —
  simpler to work with in JSON payloads, no functional difference at this
  scale.
- **`categorycount`/`categoryindex`/`titlecount`**: shipped exactly as
  planned — computed at read time in `infra/lambda/getCatalog.ts` from
  the full `Scan`, never stored.

### Open items — resolved or still open
- **Google Sheet column mapping**: resolved. `scripts/inspect-sheet.ts`
  was run first against the source sheet (see `SHEET_ID` in
  `scripts/migrate-from-sheet.ts`), tab `ALL`, to confirm headers and
  which trailing columns actually held data, before
  `scripts/migrate-from-sheet.ts` was written against the confirmed
  layout.
- **`rev` field**: resolved by omission, not by explicit confirmation
  with the librarian/admin as the plan suggested — no `rev` field appears
  anywhere in the shipped data model or migration script, so it was
  dropped silently. `editedTranslated` *was* carried over (split on
  `,`/`/` into a string array).
- **`supabase.auth.admin.listUsers()` pre-existing bug**: moot — the new
  architecture denormalizes checkout attribution into the `Checkouts`
  item at write time (see `infra/lambda/checkoutBook.ts`), so no
  Lambda ever needs an equivalent admin lookup call.
- **Custom domain**: still not configured. Using CloudFront's default
  `*.cloudfront.net` domain, which is free. Remains optional future work.

### Data migration — actual result
`scripts/migrate-from-sheet.ts` was run against the live `Catalog` table:
**1,740 catalog items** written, plus the `COUNTER#catalog` counter item
seeded to `1740`. Verified via a live `Scan` count of 1,741 total items
(1,740 rows + 1 counter). The `Checkouts` table has **0 items** — expected,
since no historical checkout state existed to migrate from Supabase.

### Cutover — actual status
1. ✅ `cdk deploy --all` — all four stacks live (see table above).
2. ✅ Migration script run — 1,740 catalog rows written.
3. ✅ Admin bootstrap — **two** Cognito users currently carry
   `custom:admin = "true"`, not the single admin the plan described.
   Confirm this is the intended admin list (see Cognito console for
   current admins).
4. ✅ Static export built and synced to S3; CloudFront shows one
   completed invalidation (2026-08-15T21:22:31Z).
5. ⬜ Smoke test — not yet confirmed done in this session. Run the full
   checklist (sign up, verify email, log in, browse/search/filter, check
   out as one user, confirm a second user sees it unavailable, admin
   create/edit/delete, sign out) against the live CloudFront domain
   before treating the migration as fully validated.
6. ⬜ Decommission the Supabase project — **not yet done**. No evidence
   the Supabase project has been paused or deleted. Keep it running until
   the smoke test above passes, then decommission.
