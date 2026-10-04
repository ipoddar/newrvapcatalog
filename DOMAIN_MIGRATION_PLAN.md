# Moving the catalog to vedanta-pitt.org/library/

This app currently runs on CloudFront's default domain
(`https://d2mxn2yqt3hfbp.cloudfront.net`) — no custom domain has ever been
configured (see `AWS_MIGRATION_PLAN.md`'s "remains optional future work"
note). This document lays out what it would take to make it reachable at
`https://www.vedanta-pitt.org/library/`, the URL currently used by a
separate, read-only WordPress "WebLib" plugin catalog on that domain.

**This is a plan only — nothing described here has been executed.**

## The comparison site today

`https://www.vedanta-pitt.org/library/` is a WordPress page using the
WebLib plugin: a read-only search/browse interface (title/author/subject/
keyword/ISBN search, sortable results, a per-item detail view showing
Status/Subject/Call Number/Type/Keywords). No accounts, no online
checkout, no admin UI — presumably checkout happens in person. This app
(now that catalog browsing is public — see the main implementation work
this covers) matches that experience for anonymous visitors, while adding
real online checkout/return/request and admin management for registered
members.

## Two possible target architectures

The right path depends on what access the domain owner actually has to
`vedanta-pitt.org`'s hosting — this needs to be answered before picking
one.

### Option A — Subdomain (e.g. `catalog.vedanta-pitt.org`)

Simpler, and the recommended default unless there's a strong reason to
want the literal `/library/` path preserved.

**This app's side:**
1. Request an ACM certificate in **us-east-1** (required for CloudFront,
   regardless of which AWS region the rest of the stack runs in) covering
   `catalog.vedanta-pitt.org`.
2. Add `domainNames: ['catalog.vedanta-pitt.org']` and `certificate: ...`
   to the `Distribution` in `infra/lib/site-stack.ts`.
3. No other app-side change needed — `NEXT_PUBLIC_API_URL`/Cognito env
   vars, CORS (`allowOrigins: ['*']` in `infra/lib/api-stack.ts`), and the
   SES sender identity are all independent of the web domain.

**Domain owner's side:**
1. Add a CNAME (or ALIAS/ANAME record, depending on their DNS provider —
   CloudFront targets can't use a plain CNAME at a zone apex, but
   `catalog.` is a subdomain so plain CNAME works) for
   `catalog.vedanta-pitt.org` → the CloudFront distribution's domain name.
2. Add a DNS CNAME validation record during ACM certificate issuance (AWS
   provides this automatically when the cert is requested — it's a
   one-time TXT/CNAME record the domain owner adds and then it's done).
3. Update the WordPress site's "Library" navigation link to point at
   `https://catalog.vedanta-pitt.org` instead of the in-WordPress
   `/library/` page.
4. Decide what happens to the existing WebLib `/library/` page — retire
   it, redirect it, or leave it as a secondary read-only mirror. This is
   a content decision for the domain owner, not an infra task.

### Option B — Literal subpath (`vedanta-pitt.org/library/`)

Matches the URL exactly, but is meaningfully more involved because this
app and the WordPress site are two separate systems that would need to
coexist under one hostname.

**This app's side:**
1. Set `basePath: '/library'` in `next.config.js` and rebuild — every
   internal route/asset reference needs to resolve under `/library/...`
   instead of `/`. (`output: 'export'` already in use is compatible with
   `basePath`.)
2. Same ACM certificate step as Option A, but for the apex/`www` domain
   this time (`vedanta-pitt.org` and/or `www.vedanta-pitt.org`).
3. CloudFront needs to serve `/library/*` from this app's S3 bucket and
   everything else from wherever WordPress is hosted — this means
   **CloudFront becomes the front door for the entire site**, not just
   this app, with path-based origin routing (`/library/*` → this app's S3
   bucket, `/*` → the existing WordPress host as a second CloudFront
   origin). This is a bigger architectural change than it sounds: it
   means putting CloudFront in front of WordPress too, which the domain
   owner may or may not want to take on.

**Domain owner's side:**
1. Whatever DNS changes are needed to point `vedanta-pitt.org`/`www.` at
   the new CloudFront distribution instead of (or in front of) wherever
   WordPress is hosted now — this depends entirely on their current setup
   (shared hosting, managed WordPress host, etc.) and may require
   contacting their hosting provider, not just a DNS change.
2. The CloudFront-in-front-of-WordPress approach **requires server/hosting
   configuration access**, not just WordPress admin access — if the
   domain owner only has WordPress admin credentials (common with
   managed/shared WordPress hosting), this option may not be feasible
   without involving whoever manages the actual server.
3. Same ACM validation record and WebLib-retirement decision as Option A.

## Recommendation

**Option A (subdomain)** unless the domain owner specifically confirms
they (or their host) can do path-based routing in front of WordPress.
Subpath migrations across two different hosting stacks are a common
source of broken asset paths and subtle routing bugs; a subdomain avoids
all of that for a one-time cost of the link in WordPress's nav reading
"Library" → `catalog.vedanta-pitt.org` instead of a same-domain path.

## What does NOT need to change either way

- Cognito: uses direct `USER_PASSWORD`/`SRP` auth flows via the SDK, not
  Cognito Hosted UI — no callback-URL domain binding exists to update.
- API Gateway CORS: already `allowOrigins: ['*']`.
- SES sender identity (`ramakrishnavedantaashramapitts@gmail.com`,
  already verified) — unrelated to the web domain.
- The Cognito User Pool, DynamoDB tables, and Lambda functions — none of
  this depends on the frontend's domain.
