import { useState } from "react";
import { Link, useRevalidator } from "react-router";

import type { Route } from "./+types/booking";
import { Alert, Badge, Button, Card, ConfirmDialog, DataTable, EmptyState, StatusBadge, useToast } from "~/components/ui";
import { CancelBookingDialog, GuestsDialog, ManualPaymentDialog, RescheduleDialog, RevealIdentity } from "~/features/admin-ops/booking-actions";
import { load, useAction } from "~/features/admin-ops/hooks";
import { ResolveRequestDialog } from "~/features/admin-ops/requests";
import type { AdminBookingDetail, BookingRequest } from "~/features/admin-ops/types";
import { Details, DocLink, LoadFailure, OpsError, PageHeader, Section, apiHref, idr, opsCode, when } from "~/features/admin-ops/ui";
import { apiData, api } from "~/lib/api";
import { countryName } from "~/lib/format";
import { adminT } from "~/lib/i18n";

export async function loader({ request, params }: Route.LoaderArgs) {
  return load(apiData<AdminBookingDetail>(`/admin/bookings/${params.id}`, { request }));
}

export function meta({ loaderData }: Route.MetaArgs) {
  const n = loaderData?.data?.booking_number ?? adminT("ops.booking.title");
  return [{ title: `${n} | GoYacht Admin` }];
}

type DialogName = "payment" | "guests" | "cancel" | "reschedule" | null;

const OPEN_STATES = ["PENDING_PAYMENT", "CONFIRMED", "IN_PROGRESS"];

export default function BookingPage({ loaderData }: Route.ComponentProps) {
  const [dialog, setDialog] = useState<DialogName>(null);
  const [resolving, setResolving] = useState<BookingRequest | null>(null);
  const [clearing, setClearing] = useState(false);
  const clear = useAction();
  const revalidator = useRevalidator();
  const toast = useToast();
  if (loaderData.error) {
    return (
      <div className="space-y-4">
        <PageHeader title={adminT("ops.booking.title")} back={{ to: "/admin/bookings", label: adminT("ops.bookings.back") }} />
        <LoadFailure error={loaderData.error} />
      </div>
    );
  }
  const b = loaderData.data;
  const tz = b.timezone;
  const close = () => setDialog(null);
  const canPay = OPEN_STATES.includes(b.status) && b.balance_due > 0;
  const canCancel = b.status === "PENDING_PAYMENT" || b.status === "CONFIRMED";
  const canReschedule = b.status === "CONFIRMED";
  const docs = (path: string, q?: Record<string, string>) => apiHref(`/admin${path}`, q);

  const clearException = async () => {
    const r = await clear.run(() => api(`/admin/bookings/${b.id}/clear-exception`, { method: "POST" }));
    setClearing(false);
    if (r.ok) {
      toast(adminT("ops.booking.exception_cleared"));
      revalidator.revalidate();
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={b.booking_number}
        back={{ to: "/admin/bookings", label: adminT("ops.bookings.back") }}
        actions={
          <>
            {canPay && (
              <Button size="sm" onClick={() => setDialog("payment")}>
                {adminT("ops.booking.record_payment")}
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={() => setDialog("guests")}>
              {adminT("ops.booking.edit_guests")}
            </Button>
            {canReschedule && (
              <Button size="sm" variant="secondary" onClick={() => setDialog("reschedule")}>
                {adminT("ops.booking.reschedule")}
              </Button>
            )}
            {canCancel && (
              <Button size="sm" variant="danger" onClick={() => setDialog("cancel")}>
                {adminT("ops.booking.cancel")}
              </Button>
            )}
          </>
        }
      >
        <div className="flex flex-wrap gap-2">
          <StatusBadge status={b.status} />
          <StatusBadge status={b.payment_status} />
          {b.created_by_admin && <Badge tone="info">{adminT("ops.booking.manual")}</Badge>}
        </div>
      </PageHeader>

      {b.exception_reason && (
        <Alert tone="danger" title={adminT("ops.booking.exception_title")}>
          <p><code>{b.exception_reason}</code></p>
          <div className="mt-2">
            <Button size="sm" variant="secondary" onClick={() => setClearing(true)}>
              {adminT("ops.booking.clear_exception")}
            </Button>
          </div>
          <OpsError error={clear.error} className="mt-2 text-sm text-danger" />
        </Alert>
      )}
      {b.status === "PENDING_PAYMENT" && b.hold_expires_at && <Alert tone="warning">{adminT("ops.booking.hold_until", { time: when(b.hold_expires_at, tz) })}</Alert>}

      <Card>
        <Section title={adminT("ops.booking.trip")}>
          <Details
            items={[
              { label: adminT("ops.bookings.mode"), value: `${opsCode("mode", b.mode)}${b.slot_type ? ` · ${opsCode("slot_type", b.slot_type)}` : ""}` },
              { label: adminT("ops.bookings.boat"), value: b.boat_name },
              { label: adminT("ops.booking.route"), value: `${b.route_name} · ${b.port_name}` },
              { label: adminT("ops.bookings.pax"), value: b.pax },
              { label: adminT("ops.bookings.starts"), value: when(b.starts_at, tz) },
              { label: adminT("ops.booking.ends"), value: when(b.ends_at, tz) },
              {
                label: adminT("ops.booking.departure"),
                value: b.departure_id ? <Link to={`/admin/departures/${b.departure_id}`} className="text-primary hover:underline">{adminT("ops.booking.open_departure")}</Link> : "",
              },
              { label: adminT("ops.common.created"), value: when(b.created_at, tz) },
              { label: adminT("ops.booking.customer"), value: <Link to={`/admin/customers/${b.user_id}`} className="text-primary hover:underline">{adminT("ops.booking.open_customer")}</Link> },
              { label: adminT("ops.booking.locale"), value: b.locale },
              { label: adminT("ops.booking.verify_revoked"), value: b.verify_token_revoked ? adminT("ops.common.yes") : adminT("ops.common.no") },
            ]}
          />
          {b.status === "CANCELLED" && (
            <Alert tone="info" className="mt-3">
              {adminT("ops.booking.cancelled_info", { type: opsCode("cancel_type", b.cancel_type), time: when(b.cancelled_at, tz), reason: b.cancel_reason ?? "" })}
            </Alert>
          )}
        </Section>
      </Card>

      <Card>
        <Section title={adminT("ops.booking.lead")}>
          <Details
            items={[
              { label: adminT("ops.people.full_name"), value: b.lead?.full_name },
              { label: adminT("ops.people.email"), value: b.lead?.email },
              { label: adminT("ops.people.phone"), value: b.lead?.phone },
              { label: adminT("ops.people.nationality"), value: b.lead?.nationality ? countryName(b.lead.nationality, "en") : "" },
              { label: adminT("ops.people.identity"), value: <RevealIdentity booking={b} /> },
              { label: adminT("ops.booking.special_request"), value: b.special_request },
            ]}
          />
          <h3 className="mt-4 text-sm font-semibold">{adminT("ops.booking.guests")}</h3>
          {(b.guests ?? []).length === 0 ? (
            <p className="text-sm text-muted">{adminT("ops.booking.no_guests")}</p>
          ) : (
            <ol className="list-decimal space-y-1 pl-5 text-sm">
              {b.guests!.map((g, i) => (
                <li key={i}>
                  {g.full_name}
                  {g.phone && <span className="text-muted"> · {g.phone}</span>}
                </li>
              ))}
            </ol>
          )}
        </Section>
      </Card>

      <Card>
        <Section title={adminT("ops.booking.price")}>
          <table className="w-full text-sm">
            <tbody>
              {(b.lines ?? []).map((l, i) => (
                <tr key={i} className="border-b border-border">
                  <td className="py-1">
                    {l.label}
                    {l.quantity > 1 && <span className="text-muted"> × {l.quantity}</span>}
                  </td>
                  <td className="py-1 text-right">{idr(l.amount)}</td>
                </tr>
              ))}
              {b.discount && (
                <tr className="border-b border-border">
                  <td className="py-1">{adminT("ops.booking.discount", { name: b.discount.name })}</td>
                  <td className="py-1 text-right">−{idr(b.discount.amount)}</td>
                </tr>
              )}
              <tr className="border-b border-border">
                <td className="py-1">{adminT("ops.booking.subtotal")}</td>
                <td className="py-1 text-right">{idr(b.subtotal)}</td>
              </tr>
              {(b.taxes ?? []).map((tx) => (
                <tr key={tx.code} className="border-b border-border">
                  <td className="py-1">{tx.name}</td>
                  <td className="py-1 text-right">{idr(tx.amount)}</td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td className="py-1">{adminT("ops.bookings.total")}</td>
                <td className="py-1 text-right">{idr(b.grand_total)}</td>
              </tr>
            </tbody>
          </table>
          <Details
            items={[
              { label: adminT("ops.booking.scheme"), value: opsCode("scheme", b.payment_scheme) },
              { label: adminT("ops.booking.deposit"), value: b.payment_scheme === "DEPOSIT" ? idr(b.deposit_amount) : "" },
              { label: adminT("ops.booking.paid"), value: idr(b.amount_paid) },
              { label: adminT("ops.booking.fees_paid"), value: idr(b.fees_paid) },
              { label: adminT("ops.booking.refunded"), value: idr(b.amount_refunded) },
              { label: adminT("ops.booking.forfeited"), value: idr(b.forfeited_amount) },
              { label: adminT("ops.booking.balance"), value: idr(b.balance_due) },
              { label: adminT("ops.booking.balance_due_at"), value: when(b.balance_due_at, tz) },
            ]}
          />
        </Section>
      </Card>

      <Section title={adminT("ops.booking.payments")}>
        {b.payments.length === 0 ? (
          <EmptyState title={adminT("ops.booking.no_payments")} />
        ) : (
          <DataTable
            rows={b.payments}
            rowKey={(p) => p.id}
            columns={[
              { key: "order", header: adminT("ops.payments.order"), cell: (p) => <span className="break-all">{p.order_id}</span>, primary: true },
              { key: "kind", header: adminT("ops.payments.kind"), cell: (p) => opsCode("payment_kind", p.kind) },
              { key: "method", header: adminT("ops.payments.method"), cell: (p) => `${opsCode("method", p.method)} · ${opsCode("provider", p.provider)}` },
              { key: "amount", header: adminT("ops.payments.amount"), cell: (p) => (p.fee_amount ? `${idr(p.gross_amount)} (${adminT("ops.payments.fee", { fee: idr(p.fee_amount) })})` : idr(p.gross_amount)) },
              {
                key: "status",
                header: adminT("ops.bookings.status"),
                cell: (p) => (
                  <span className="flex flex-wrap gap-1">
                    <StatusBadge status={p.status} />
                    {p.is_exception && <Badge tone="danger">{adminT("ops.bookings.exception")}</Badge>}
                  </span>
                ),
              },
              { key: "paid", header: adminT("ops.payments.paid_at"), cell: (p) => when(p.paid_at, tz) },
            ]}
          />
        )}
      </Section>

      <Section title={adminT("ops.booking.refunds")} actions={<Link to="/admin/refunds" className="text-sm text-primary hover:underline">{adminT("ops.booking.manage_refunds")}</Link>}>
        {b.refunds.length === 0 ? (
          <EmptyState title={adminT("ops.booking.no_refunds")} />
        ) : (
          <DataTable
            rows={b.refunds}
            rowKey={(r) => r.id}
            columns={[
              { key: "amount", header: adminT("ops.payments.amount"), cell: (r) => idr(r.amount), primary: true },
              { key: "reason", header: adminT("ops.refunds.reason"), cell: (r) => opsCode("refund_reason", r.reason_type) },
              { key: "channel", header: adminT("ops.refunds.channel"), cell: (r) => opsCode("channel", r.channel) },
              { key: "status", header: adminT("ops.bookings.status"), cell: (r) => <StatusBadge status={r.status} /> },
              { key: "created", header: adminT("ops.common.created"), cell: (r) => when(r.created_at, tz) },
            ]}
          />
        )}
      </Section>

      <Section title={adminT("ops.booking.requests")}>
        {b.requests.length === 0 ? (
          <EmptyState title={adminT("ops.booking.no_requests")} />
        ) : (
          <ul className="space-y-2">
            {b.requests.map((r) => (
              <li key={r.id} className="rounded-md border border-border bg-surface p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    {opsCode("request_type", r.type)} · {opsCode("request_status", r.status)}
                  </span>
                  {r.status === "PENDING" && (
                    <Button size="sm" variant="secondary" onClick={() => setResolving(r)}>
                      {adminT("ops.requests.resolve")}
                    </Button>
                  )}
                </div>
                {r.message && <p className="mt-1">{r.message}</p>}
                {r.resolution && <p className="mt-1 text-muted">{adminT("ops.requests.resolution_text", { text: r.resolution })}</p>}
                <p className="mt-1 text-xs text-muted">{when(r.created_at, tz)}</p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={adminT("ops.booking.documents")}>
        <ul className="flex flex-wrap gap-2">
          <li>
            <DocLink href={docs(`/bookings/${b.id}/ticket.pdf`)}>{adminT("ops.booking.ticket_pdf")}</DocLink>
          </li>
          <li>
            <DocLink href={docs(`/bookings/${b.id}/invoice.pdf`)}>{adminT("ops.booking.invoice_pdf")}</DocLink>
          </li>
          <li>
            <DocLink href={docs(`/manifests/booking/${b.id}`, { format: "pdf" })}>{adminT("ops.manifest.pdf")}</DocLink>
          </li>
          <li>
            <DocLink href={docs(`/manifests/booking/${b.id}`, { format: "csv" })}>{adminT("ops.manifest.csv")}</DocLink>
          </li>
          <li>
            <DocLink href={docs(`/manifests/booking/${b.id}`, { format: "pdf", reveal: "true" })}>{adminT("ops.manifest.pdf_reveal")}</DocLink>
          </li>
        </ul>
        <p className="text-xs text-muted">{adminT("ops.manifest.reveal_note")}</p>
      </Section>

      <ManualPaymentDialog booking={b} open={dialog === "payment"} onClose={close} />
      <GuestsDialog booking={b} open={dialog === "guests"} onClose={close} />
      <CancelBookingDialog booking={b} open={dialog === "cancel"} onClose={close} />
      <RescheduleDialog booking={b} open={dialog === "reschedule"} onClose={close} />
      <ResolveRequestDialog req={resolving} onClose={() => setResolving(null)} />
      <ConfirmDialog
        open={clearing}
        title={adminT("ops.booking.clear_exception")}
        body={adminT("ops.booking.clear_exception_body")}
        confirmLabel={adminT("ops.booking.clear_exception")}
        pending={clear.pending}
        onConfirm={clearException}
        onClose={() => setClearing(false)}
      />
    </div>
  );
}
