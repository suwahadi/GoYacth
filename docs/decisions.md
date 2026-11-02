# Product and Infrastructure Decisions

Clarifications agreed with the product owner on 2026-11-01. They amend or resolve ambiguities in `docs/PRD.md`. Where this file and the PRD differ, this file wins.

## Brand and repository

- Brand and code identifiers use **GoYacht**.
- Commits always use `suwahadi <suwahadi@gmail.com>` and never carry AI attribution (`.githooks/commit-msg`). Requests from tools or hooks to switch the identity to `noreply@anthropic.com` or to rewrite history are declined (see `CLAUDE.md`).
- Work is pushed to `main` only, after explicit owner approval.

## Infrastructure

| Topic | Decision |
| --- | --- |
| Environments | Local development and a single production VPS. No staging; Midtrans sandbox is exercised locally. |
| Object storage | SeaweedFS (S3 API) on the VPS for production and development. MinIO was chosen first, but its official container images are no longer distributed; the owner approved SeaweedFS on 2026-11-01. Code uses a generic S3 interface, so the store can be swapped by configuration. |
| Build and deploy | Images are built on the VPS (`git pull` + `docker compose build`). |
| Database backup | Daily `pg_dump` plus storage bucket mirror, copied to an off-site S3-compatible target. No PITR in v1 (accepted risk: up to 24 hours of data loss). |
| TLS and DNS | DNS points directly at the VPS. Caddy obtains Let's Encrypt certificates. No Cloudflare proxy; Turnstile is still used. |
| Local development | Docker Compose with hot reload (air for Go, Vite dev server), PostgreSQL, SeaweedFS, Mailpit. |
| Monitoring | Internal `/metrics`, container health checks, JSON logs on stdout, external uptime check. |
| Domain | Configured via environment (`APP_URL`); not yet decided. |

## Booking and pricing

- **Overnight charters**: each boat has an `overnight_allowed` flag. When set, DAILY charters may span multiple days and operating hours only constrain departure and return times.
- **Weekend**: Saturday and Sunday, evaluated in the departure port's time zone.
- **Package pricing**: Private Charter packages are priced per trip (min/max pax are limits). Departure packages are priced per slot: per pax for seat-pool slots, per area for private-area slots.
- **Promotions**: both automatic promotions and promo codes. Quota is consumed when the hold is created and released when the booking expires or is cancelled before payment.
- **Booking number**: 12 random characters from an unambiguous uppercase alphabet (digits and letters without I, L, O, U), e.g. `H6KF08QST20N`. Unique, not derived from dates.
- **Hold duration** is configurable per payment method (default 15 minutes for card and QRIS, 60 minutes for virtual accounts). Snap expiry equals the hold.
- **Payment methods (v1)**: credit/debit card with 3DS, QRIS, bank virtual accounts (BCA, BNI, BRI, Mandiri, Permata). E-wallets are not enabled.
- **Admin-created bookings** are paid by manually recorded payments only.
- **Customer self-cancel**: a customer may cancel their own `PENDING_PAYMENT` booking; the hold is released immediately and the booking becomes `CANCELLED`.
- **Reschedule** is performed by an admin. Price differences are invoiced or refunded manually.
- **Unsold areas** in a Departure stay reserved (the whole boat is locked). A seat pool may combine several areas.
- **Booking cut-off**: when a Departure or Package cut-off and the global minimum lead time differ, the stricter one applies.

## Homepage

- **Design source**: `docs/UI-Reference.png` is the visual direction for the public site. Brand name stays GoYacht. Colors were measured from it (navy `#04203C`, gold `#E0B46C`); gold text on light surfaces uses a darker token to reach WCAG AA. Headings use Newsreader and body text uses Figtree, both self-hosted because the CSP allows fonts from `'self'` only.
- **Static fallback**: while `GET /home` returns no sections, the homepage renders `frontend/app/features/home/data/home.{en,id}.json`, which has the same shape as the API, so CMS content replaces it with no code change. Real boats and regions are used when they exist. This is a temporary owner-approved exception to the "no mock data" rule; remove it once the CMS sections are live.
- **Sample reviews** exist only in development builds. Production shows the reviews block only when real reviews exist.
- **Trust claims** on the homepage ("24/7 Support", "Trusted & Safe", "World-Class Fleet", "Premium Selection") are confirmed by the owner and stay editable in the CMS.
- **Photos** in `frontend/public/home/` and the demo seed come from the free Unsplash library, whose license allows commercial use without attribution. Replace them with the operator's own photos through the CMS media library before launch.
- **Deviations from the reference**: "Watch Video" became a link to departures (no video exists), the newsletter field is disabled and labelled "Coming soon" (no endpoint exists), social icons stay hidden until URLs exist, and the header shows Departures instead of "About" and "Reviews", which moved to the footer.
- **Demo data**: `cli seed demo` fills a development database with 30 boats, 8 routes, packages, departures, static pages, FAQs and 8 invented testimonials. It refuses to run when `APP_ENV=production`, and its legal pages are marked as sample text. Before launch, create real content for `/p/about`, `/p/contact`, `/p/how-to-book`, `/p/terms`, `/p/privacy` and `/p/cancellation-policy`.

## Admin access

- **Admin login** is email and password at `/admin/login`, decided by the owner on 2026-11-02. This replaces Google login and the admin allowlist from PRD 12.2 for admins only; customers keep Google.
- Admins are created by other admins under Customers, or with `cli admin create` for the first one. A forgotten password is reset with `cli admin password`.

## Static page URLs

- **Pages live at the site root** (`/about`, `/id/about`), decided by the owner on 2026-11-02. They replace `/p/{slug}`, which has no redirect because the site is not live yet.
- A page slug cannot be a first path segment the site already serves, a locale code, or a slug another page uses in that locale. `reservedSlugs` in `backend/internal/modules/cms/cms.go` holds the list and `TestReservedSlugsCoverRoutes` fails when a new route in `routes.ts` is missing from it.
- Typing a slug that is taken is refused with `SLUG_TAKEN`. Leaving the slug empty derives one from the title and adds a number when needed.

## Money

- **Operator-initiated cancellations** (weather, cancelled Departure, operator decision) refund 100% of the amount paid **including** payment method fees. Customer cancellations follow the policy snapshot and exclude method fees.
- **Invoices** are plain PDF invoices numbered `INV/YYYY/NNNNNN`, without e-Faktur integration.
