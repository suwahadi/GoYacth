# Product and Infrastructure Decisions

Clarifications agreed with the product owner on 2026-11-01. They amend or resolve ambiguities in `docs/PRD.md`. Where this file and the PRD differ, this file wins.

## Brand and repository

- Brand and code identifiers use **GoYacht**.
- Commits use the repository owner's identity and never carry AI attribution (`.githooks/commit-msg`).
- Work is pushed to `main` only, after explicit owner approval.

## Infrastructure

| Topic | Decision |
| --- | --- |
| Environments | Local development and a single production VPS. No staging; Midtrans sandbox is exercised locally. |
| Object storage | MinIO on the VPS (production and development). |
| Build and deploy | Images are built on the VPS (`git pull` + `docker compose build`). |
| Database backup | Daily `pg_dump` plus MinIO bucket mirror, copied to an off-site S3-compatible target. No PITR in v1 (accepted risk: up to 24 hours of data loss). |
| TLS and DNS | DNS points directly at the VPS. Caddy obtains Let's Encrypt certificates. No Cloudflare proxy; Turnstile is still used. |
| Local development | Docker Compose with hot reload (air for Go, Vite dev server), PostgreSQL, MinIO, Mailpit. |
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

## Money

- **Operator-initiated cancellations** (weather, cancelled Departure, operator decision) refund 100% of the amount paid **including** payment method fees. Customer cancellations follow the policy snapshot and exclude method fees.
- **Invoices** are plain PDF invoices numbered `INV/YYYY/NNNNNN`, without e-Faktur integration.
