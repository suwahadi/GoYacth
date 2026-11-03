# AGENTS.md — Boat & Yacht Rental Platform Engineering Contract

The product specification lives in the PRD. This file defines how the system is built. When the PRD and this file conflict, stop and ask.

## 1. Mission

Build a production-ready, API-first boat and yacht rental platform for a single operator that also sells partner-owned boats.

This is a new application. There is no legacy codebase to migrate.

Implement real workflows. Never ship mock data, placeholder pages, or fake success responses as production functionality.

Priorities, in order:

1. Security, financial integrity, and inventory consistency.
2. Correct business rules.
3. Maintainability and architectural consistency.
4. Mobile usability and accessibility.
5. Performance and operational reliability.
6. Simplicity.

Work autonomously. Inspect existing files before changing them. Keep the application runnable at each milestone. If a task is blocked by a missing credential or service, document the blocker and continue with independent work.

Do not invent business requirements. Ask a targeted question only when an unresolved decision affects correctness, security, money, or data integrity.

## 2. Technology Stack

### Backend

- Go, latest stable release.
- Modular monolith.
- HTTP router: Chi.
- PostgreSQL with pgx and sqlc.
- Migrations: goose.
- Background jobs: River (PostgreSQL-backed queue). Jobs that must accompany a database change are enqueued inside the same transaction.
- Image processing: libvips via govips.
- PDF: a maintained, code-driven Go PDF library. Do not use a headless browser.
- Logging: log/slog, structured JSON.
- Metrics: Prometheus-compatible endpoint.
- API docs: OpenAPI.

Redis is not part of v1. Do not add it unless a measured need exists and is documented.

### Frontend

- React with TypeScript (strict).
- React Router in framework mode with SSR.
- Vite.
- Tailwind CSS.
- Node.js LTS, used only to render and serve the frontend.

Node.js must never contain business logic. Do not build a second backend in Express, Next.js, or React Router loaders/actions. Loaders and actions call the Go API; they do not compute prices, availability, permissions, or payment state.

### Infrastructure

- Docker and Docker Compose.
- PostgreSQL with the btree_gist extension.
- S3-compatible object storage.
- Caddy as reverse proxy: `/api/*` to Go, everything else to the SSR server.

### Versions

- Verify current stable versions from official sources before adding a dependency. Never claim a version is latest without checking.
- No prerelease, beta, RC, nightly, or deprecated packages.
- Pin Go and Node.js versions. Commit `go.sum` and the frontend lockfile.
- Prefer the standard library and existing dependencies over new packages.

## 3. Repository Layout

```
backend/
  cmd/api/            main for HTTP server
  cmd/worker/         main for River worker
  cmd/cli/            admin bootstrap and maintenance commands
  internal/
    platform/         config, db, http middleware, logging, errors, i18n
    modules/
      auth/  users/  catalog/  departures/  packages/  pricing/
      bookings/  bookingadmin/  payments/  refunds/  settlements/
      tickets/  media/  cms/  reviews/  notifications/  reports/
      settings/  audit/  scheduler/  seed/
    integrations/     midtrans/, google/, smtp/, storage/
  db/
    migrations/
    queries/          sqlc input
  locales/{en,id}/
  templates/email/
frontend/
  app/
    routes/
    components/ui/    shared design-system components
    features/         feature components and hooks
    locales/{en,id}/
    lib/              api client, formatters, i18n
.githooks/
docker/
docs/
```

Each module may contain `handler.go`, `service.go`, `repository.go`, `types.go`, and `dto.go`. Create only the files the module needs.

`catalog` owns partners and locations, and `bookings` owns inventory. `bookingadmin` (admin booking operations, public tracking and QR verification) and `scheduler` (periodic job bodies) depend on both `bookings` and `refunds`, so they stay separate to keep imports acyclic. `seed` holds the reference data inserted by `cli seed reference`.

## 4. Backend Architecture

- Handlers parse and validate input, call a service, and write the response. Keep them thin.
- Services own business rules and transaction boundaries.
- Repositories wrap sqlc queries. Do not add a repository layer that only forwards calls.
- Domain types and state transitions live in the module's `types.go`.
- Integrations wrap external systems behind small interfaces so they can be faked in tests.
- No business logic in handlers, SQL triggers, frontend components, or SSR loaders.
- No global mutable state. No circular imports between modules; shared needs go to `platform`.
- Pass `context.Context` through every call that does I/O. Respect cancellation and timeouts.

## 5. API Standards

- All endpoints under `/api/v1`.
- Success: `{"data": ..., "meta": ...}`. Omit `meta` when empty.
- Error: `{"error": {"code": "BOOKING_SLOT_TAKEN", "message": "...", "fields": {...}}}`.
- `code` is stable, English, SCREAMING_SNAKE_CASE. The frontend translates codes into user-facing text. `message` is an English developer hint.
- Use correct status codes: 400, 401, 403, 404, 409, 410, 422, 429, 500.
- Explicit input DTOs per endpoint. Never bind request bodies directly onto database rows.
- Explicit response DTOs. Never serialize database rows directly.
- Pagination, filtering, and sorting with whitelisted fields only.
- ISO 8601 timestamps in UTC.
- Every response carries `X-Request-ID`.
- `POST /bookings`, payment creation, and admin manual payment require an `Idempotency-Key` header.
- Keep OpenAPI in sync with handlers.

## 6. Domain Rules

Follow the PRD for full detail. These rules are non-negotiable.

### Concepts

- Category, Class, Partner, Boat, Area, Region, Port, Route, Departure, Departure Slot, Package are distinct entities.
- Deck is a label on Area, not a table.
- Every boat has at least one Area. A boat with no separately sold areas has one system area.
- Booking modes: `PRIVATE_CHARTER` and `DEPARTURE`. Packages wrap one of these modes; they are not a third booking engine.
- Areas are sold only through Departures. Private Charter always locks the whole boat.

### Inventory invariants

PostgreSQL is the single source of truth.

- `area_reservations` holds one row per area per occupied time range, with an exclusion constraint preventing overlap on the same area.
- Private Charter inserts rows for every area of the boat, with the range widened by the boat's turnaround buffer.
- Creating a Departure inserts rows for every area of the boat.
- Maintenance and manual blocks insert `BLOCK` rows.
- Private-area slots in a Departure are protected by a partial unique index on active bookings.
- Seat-pool slots are reserved inside a transaction that locks the Departure row with `SELECT ... FOR UPDATE`. Total passengers in a Departure must never exceed the boat's legal capacity.
- A booking transaction first removes expired holds that overlap the requested inventory. Correctness must not depend on a cleanup job having run.
- Never use read-then-write outside a transaction for inventory.
- Never rely on frontend state or disabled buttons for consistency.

### Pricing

- Prices are computed only on the server. Ignore any price, total, tax, or status sent by a client.
- Money is `int64` IDR in Go and `BIGINT` in PostgreSQL. No floats for money anywhere, including the frontend.
- Round each tax or fee line to whole rupiah, as specified in the PRD.
- Every booking stores an immutable snapshot of price lines, applied rules, promo, taxes, fees, payment policy, cancellation policy, and partner commission.

### State machines

Define each state set once, as typed constants, with an explicit transition table and a single function that applies transitions.

- Booking: `PENDING_PAYMENT`, `CONFIRMED`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `EXPIRED`.
- Booking payment status: `UNPAID`, `DEPOSIT_PAID`, `PAID`, `PARTIALLY_REFUNDED`, `REFUNDED`.
- Payment: `PENDING`, `SUCCEEDED`, `FAILED`, `EXPIRED`, `CANCELLED`.
- Refund: `REQUESTED`, `APPROVED`, `PROCESSING`, `COMPLETED`, `REJECTED`.

Reject invalid transitions on the server. Transitions only move forward. Keep the database CHECK constraint, Go constants, OpenAPI enums, and frontend types consistent.

## 7. Payments and Webhooks

- Midtrans `order_id` is unique per payment attempt, not per booking.
- Snap expiry must not exceed the inventory hold or the balance deadline.
- Customers pick the payment method before the Snap token is created. Method fees are added as a separate item, and Snap is restricted to that method.
- Never change payment or booking state from a browser callback or redirect.

Webhook processing order:

1. Read the raw body.
2. Verify `signature_key` per Midtrans specification with constant-time comparison.
3. Query the Midtrans Status API for the authoritative state.
4. Match order ID, gross amount, currency, and merchant against server records.
5. Store the raw event in `payment_events`, deduplicated by a stable key.
6. Apply the state transition and enqueue side-effect jobs in one database transaction.
7. Return a response that follows Midtrans retry semantics.

Duplicate, concurrent, and out-of-order events must produce the same final state as a single event.

A successful payment for an `EXPIRED` or `CANCELLED` booking never reactivates it automatically. Record the payment and place the booking in the admin exception queue.

Never log signatures, server keys, or full payment payloads containing personal data.

Manual payments recorded by admins must not exceed the outstanding balance, require an idempotency key, and are written to the audit log.

Refunds are complete only after provider confirmation or recorded transfer proof.

## 8. Authentication and Authorization

- Customers sign in with Google OIDC (authorization code flow with PKCE, completed in the Go backend) or with email and password. Google accounts are identified by provider plus Google `sub`, and Google accounts whose email is not verified are rejected.
- One customer account per email address. Google sign-in joins an existing customer with the same address.
- Sign-up takes a name and an email, never a password. The password is chosen on the page the emailed link opens, so only the owner of the inbox sets it, and that also confirms the address. Signing up with an address that is already confirmed sends its owner a link to set a password instead. Customer passwords need at least 8 characters; reset links last one hour and end every session.
- A customer cannot book until their email is confirmed; the booking API checks this as well.
- Admins sign in with email and password at `/admin/login`. Hash with bcrypt, require at least 12 characters, lock an account for 15 minutes after 5 failures, and answer every failure identically.
- Server-side sessions in PostgreSQL, referenced by an HttpOnly, Secure, SameSite=Lax cookie. Sessions can be revoked.
- Do not store tokens in localStorage or sessionStorage.
- CSRF protection on all cookie-authenticated mutations.
- Roles: `ADMIN`, `CUSTOMER`. All admins have equal access.
- The first admin is created by a CLI command. Further admins are created by existing admins. Customer sign-in never grants admin, and a role sent by the client is never trusted.
- The last active admin cannot be deactivated.
- Every customer resource checks ownership. A booking belonging to another user returns 404.
- SSR must never render one user's data into a cacheable response.

## 9. Personal Data

- Identity numbers (KTP, SIM, passport, KITAS/KITAP) are encrypted at the application layer with AES-256-GCM. Keys come from the environment or a secret manager and must support rotation.
- Admin views show the last four characters. Revealing the full value is an explicit action recorded in the audit log.
- Identity numbers are deleted by a scheduled job after the retention period.
- Identity numbers, phone numbers, and full names never appear in logs, public tracking, verification pages, or URLs.
- Account deletion anonymizes personal data and keeps financial records.

## 10. Media

- Validate size, detected MIME type, and full decode. Enforce a pixel-dimension limit against decompression bombs.
- Apply EXIF orientation, then strip metadata.
- Produce WebP variants at the widths defined in the PRD. Never upscale.
- Generate server-side filenames: entity slug, random suffix, width. Never use client filenames.
- Replacing an image always creates new files. Never overwrite an existing object.
- Delete superseded files only through a job enqueued in the same transaction as the database change, and only when no `media_usages` row references the file.
- A daily job removes orphaned uploads older than 24 hours.
- Private files (payment proofs) live in a private bucket and are served through short-lived signed URLs.

## 11. Email

- Use a generic SMTP client configured entirely from environment variables. Do not hard-code or depend on a specific provider.
- Send through jobs with retry and backoff. A unique key per notification type and booking prevents duplicates.
- Templates are HTML plus plain text, localized from `backend/locales`.

## 12. Internationalization

- Public site and customer portal: English (default, root URLs) and Indonesian (`/id` prefix).
- Admin dashboard: English only, but all admin strings still live in locale files.
- UI strings live in `frontend/app/locales/{locale}/{namespace}.json`. Keys are type-checked; a missing or misspelled key fails the build.
- Adding a language must require only a new locale folder and one config entry, with no database migration.
- Admin-managed content is stored in translation tables with a `locale` column. Never add per-language columns such as `name_en`.
- Format dates, numbers, and currency with `Intl` through shared formatters. Never hard-code formatted strings in components.
- Display departure times in the departure port's time zone with its label (WIB, WITA, WIT). Store all timestamps in UTC.
- Country names come from ISO 3166-1 codes rendered with `Intl.DisplayNames`.
- All code, identifiers, API fields, error codes, enums, comments, logs, commits, and developer docs are in English.

## 13. Frontend

- Shared components in `components/ui`: buttons, inputs, selects, searchable select, phone input, form field with error, dialog, drawer, dropdown, table and mobile list, pagination, filters, skeleton, empty and error states, toast, confirm dialog, badge, status indicator.
- Reuse shared components. Do not create visually inconsistent one-off alternatives.
- Mobile-first. No horizontal overflow. Compact but readable density. Filters collapse into a drawer on mobile with visible active-filter indicators.
- When exactly two sibling buttons share a row, use equal width.
- Every data screen has loading, empty, error, and success states.
- Submit buttons show a pending state and are disabled during the request. Obsolete requests are cancelled.
- Semantic HTML, keyboard navigation, visible focus states, sufficient contrast.
- User-facing messages are short and actionable.

### Theme

- Public site and customer portal support Light (default), Dark, and System.
- Store the preference in a cookie so SSR renders the correct theme without a flash.
- Colors come from design tokens only. No hard-coded colors in components.
- Admin dashboard, emails, and PDFs are always light.

### SEO

- SSR for every indexable page, with title, description, canonical, Open Graph, Twitter Card, hreflang, and valid JSON-LD.
- Per-locale XML sitemaps and robots.txt.
- 301 redirects on slug change. Correct 404 and 410 responses.
- `noindex` on account, checkout, tracking, and verification pages.
- Filter combinations canonicalize to the main listing.

## 14. Performance

- Target Lighthouse Performance above 85 on production builds of key public pages, with green Core Web Vitals where feasible. Measure; do not guess.
- Code-split routes. Keep admin code out of public bundles.
- Responsive images with explicit dimensions to prevent layout shift.
- Long-lived immutable caching for hashed assets and media. Never cache personalized or availability responses publicly.
- No N+1 queries. No unbounded reads. Index every foreign key and every filtered column.

## 15. Errors and Logging

- Validate every input on the server.
- Never leak stack traces, SQL, file paths, or upstream responses to clients.
- Log unexpected errors with request ID, at the boundary, once.
- Never swallow errors or return fake success.
- Distinguish validation, authentication, authorization, not found, conflict, rate limit, and server errors.

## 16. Deletion and Retention

- No soft deletes. Do not add `deleted_at`, `is_deleted`, or equivalents.
- Entities referenced by bookings, payments, refunds, payouts, or audit logs cannot be deleted. Use an explicit `ARCHIVED` status where the business needs to hide them.
- Retention rules (identity numbers, media) are implemented as explicit scheduled jobs.
- Audit logs cannot be modified or deleted through any API.

## 17. Docker and Deployment

- Multi-stage Dockerfiles for API, worker, and frontend. Production images run as non-root.
- The backend image includes libvips.
- Compose services: postgres, api, worker, frontend, caddy, and an S3-compatible store for local development.
- Health checks on every service. Graceful shutdown on SIGTERM.
- Logs to stdout and stderr.
- `.env.example` with placeholders only. Validate configuration at startup and fail fast.
- Never bake secrets into images.
- Document start, stop, migrate, backup, and restore procedures.

## 18. Testing and Quality Gates

- Integration tests run against a real PostgreSQL instance (for example via testcontainers). Do not mock the database for inventory, payment, or booking logic.
- Concurrency tests fire parallel requests and assert exact outcomes.
- Every mandatory scenario in the PRD testing section has an automated test.
- Webhook tests cover invalid signatures, amount mismatch, duplicates, concurrency, and out-of-order delivery.
- Upload tests cover spoofed extensions, corrupt files, and oversized images.
- Frontend: Vitest for components and hooks, Playwright for checkout, payment status, and account flows.

Before reporting a task complete, run: formatting, `go vet`, linting, type checking, unit and integration tests, frontend production build, and Docker build.

Never skip or weaken tests to make a build pass. Report tests that could not run and why.

## 19. Code Style and Comments

- Code must be self-explanatory through naming, types, and structure.
- No comments that restate the code, no decorative section dividers, no file banners, no TODO without an issue reference.
- Comments are allowed only for non-obvious reasoning: concurrency, security constraints, provider quirks, invariants, workarounds.
- Keep required tool directives, license notices, and generated-code markers.
- Never remove comments with a global regex. Review each removal in context.

## 20. Git Policy

- Never add AI co-author or attribution trailers to commits. This includes `Co-authored-by` lines naming Claude, Anthropic, ChatGPT, OpenAI, Copilot, Gemini, Cursor, or any other AI tool, and footers such as "Generated with ...".
- If the coding tool adds attribution by default, disable it in that tool's configuration.
- The repository enforces this with `.githooks/commit-msg`. Enable it with `git config core.hooksPath .githooks`. CI runs the same check on every commit in a pull request.
- Use the repository owner's configured Git identity. Inspect it before committing. Do not change global Git configuration.
- Concise, descriptive commit messages in English.
- Do not amend, rebase, force-push, rewrite history, push, create releases, or touch protected branches without explicit authorization.
- Inspect the staged diff before every commit.
- Never claim a commit or push succeeded unless it did.

## 21. Documentation

- Developer documentation in English, kept in sync with the code: setup, environment variables, Docker, migrations, testing, deployment, backup and restore.
- Do not create documents that duplicate this file or the PRD.

## 22. Definition of Done

A task is done only when:

- The behavior matches the PRD.
- Validation and authorization are enforced on the server.
- Inventory and money invariants hold under concurrency.
- Relevant tests pass, or blocked tests are reported with reasons.
- Type checking, linting, production build, and Docker build succeed.
- UI follows the shared design system, works on mobile, and supports both themes where required.
- All user-facing text exists in every supported locale.
- No unnecessary comments were added.
- No AI attribution exists in any commit.
- Documentation is updated where needed.

At each milestone, report what was implemented, which checks ran with their actual results, known issues, and the next concrete steps.
