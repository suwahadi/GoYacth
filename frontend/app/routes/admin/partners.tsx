import { useEffect, useState } from "react";
import { Link, useRevalidator } from "react-router";

import type { Route } from "./+types/partners";
import { Alert, Button, ButtonPair, Card, Checkbox, DataTable, Dialog, EmptyState, Field, FilterBar, Input, Select, StatusBadge, Textarea, useFieldErrors, useToast } from "~/components/ui";
import { loadPartners } from "~/features/admin-ops/catalog";
import { load, useAction, useFilterParams } from "~/features/admin-ops/hooks";
import { ProofUpload } from "~/features/admin-ops/proof-upload";
import { ADMIN_TZ, isValidYmd, todayIn } from "~/features/admin-ops/time";
import type { Partner, Payout, Settlement } from "~/features/admin-ops/types";
import { Details, LoadFailure, OpsError, PageHeader, Pending, Section, apiHref, idr, plainDate, when } from "~/features/admin-ops/ui";
import { api, apiData } from "~/lib/api";
import { adminT } from "~/lib/i18n";

const FILTERS = ["partner_id", "period_start", "period_end"];

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const partnerId = url.searchParams.get("partner_id") || "";
  const start = url.searchParams.get("period_start") || "";
  const end = url.searchParams.get("period_end") || "";
  const ready = !!partnerId && isValidYmd(start) && isValidYmd(end);
  const [partners, settlement, payouts] = await Promise.all([
    load(loadPartners(request)),
    ready ? load(apiData<Settlement>("/admin/settlements", { request, query: { partner_id: partnerId, period_start: start, period_end: end } })) : Promise.resolve(null),
    load(apiData<Payout[]>("/admin/payouts", { request, query: { partner_id: partnerId || undefined } })),
  ]);
  return { partners, settlement, payouts, query: { partnerId, start, end } };
}

export function meta() {
  return [{ title: `${adminT("ops.partners.title")} | GoYacht Admin` }];
}

function PayoutDialog({ open, onClose, partner, start, end, bookingIds, total }: { open: boolean; onClose: () => void; partner: Partner; start: string; end: string; bookingIds: string[]; total: number }) {
  const [paidOn, setPaidOn] = useState("");
  const [proof, setProof] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const action = useAction();
  const fields = useFieldErrors(action.error);
  const revalidator = useRevalidator();
  const toast = useToast();
  useEffect(() => {
    if (!open) return;
    setPaidOn(todayIn(ADMIN_TZ));
    setProof(null);
    setNotes("");
    action.reset();
  }, [open]);
  const submit = async () => {
    const body = { partner_id: partner.id, period_start: start, period_end: end, booking_ids: bookingIds, paid_on: paidOn, proof_media_id: proof, notes };
    const r = await action.run(() => api("/admin/payouts", { method: "POST", body }));
    if (r.ok) {
      toast(adminT("ops.partners.payout_recorded"));
      onClose();
      revalidator.revalidate();
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={adminT("ops.partners.record_payout")}
      footer={
        <ButtonPair>
          <Button variant="secondary" onClick={onClose} disabled={action.pending}>
            {adminT("ops.common.cancel")}
          </Button>
          <Button onClick={submit} pending={action.pending} disabled={!paidOn || bookingIds.length === 0}>
            {adminT("ops.partners.record_payout")}
          </Button>
        </ButtonPair>
      }
    >
      <div className="space-y-3 text-sm">
        <p>{adminT("ops.partners.payout_summary", { count: bookingIds.length, amount: idr(total), partner: partner.name })}</p>
        <Details
          items={[
            { label: adminT("ops.partners.bank"), value: partner.bank_name },
            { label: adminT("ops.partners.account"), value: `${partner.bank_account_number} · ${partner.bank_account_name}` },
          ]}
        />
        <Field label={adminT("ops.payment_dialog.paid_on")} required error={fields.paid_on}>
          {(p) => <Input {...p} type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />}
        </Field>
        <ProofUpload slug={`payout-${partner.name}`} onChange={setProof} />
        <Field label={adminT("ops.common.notes")}>{(p) => <Textarea {...p} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
        <OpsError error={action.error} />
      </div>
    </Dialog>
  );
}

export default function PartnersPage({ loaderData }: Route.ComponentProps) {
  const f = useFilterParams();
  const [selected, setSelected] = useState<string[]>([]);
  const [paying, setPaying] = useState(false);
  const { query } = loaderData;
  const settlementKey = JSON.stringify(query);
  useEffect(() => setSelected([]), [settlementKey]);
  if (loaderData.partners.error) return <LoadFailure error={loaderData.partners.error} />;
  const partners = loaderData.partners.data;
  const partner = partners.find((p) => p.id === query.partnerId);
  const settlement = loaderData.settlement;
  const lines = settlement?.data?.lines ?? [];
  const unpaid = lines.filter((l) => !l.payout_id);
  const selectedTotal = lines.filter((l) => selected.includes(l.booking_id)).reduce((sum, l) => sum + l.partner_amount, 0);
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <div className="space-y-4">
      <PageHeader title={adminT("ops.partners.title")}>
        <p className="text-sm text-muted">{adminT("ops.partners.intro")}</p>
      </PageHeader>
      <FilterBar activeCount={f.activeCount(FILTERS)} onClear={() => f.clear(FILTERS)}>
        <Field label={adminT("ops.partners.partner")}>
          {(p) => (
            <Select {...p} value={f.get("partner_id")} onChange={(e) => f.set({ partner_id: e.target.value })}>
              <option value="">{adminT("ops.common.choose")}</option>
              {partners.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={adminT("ops.partners.period_start")}>{(p) => <Input {...p} type="date" value={f.get("period_start")} onChange={(e) => f.set({ period_start: e.target.value })} />}</Field>
        <Field label={adminT("ops.partners.period_end")}>{(p) => <Input {...p} type="date" value={f.get("period_end")} onChange={(e) => f.set({ period_end: e.target.value })} />}</Field>
      </FilterBar>

      <Pending>
        {partners.length === 0 ? (
          <EmptyState title={adminT("ops.partners.no_partners")} />
        ) : !settlement ? (
          <EmptyState title={adminT("ops.partners.choose")} />
        ) : settlement.error ? (
          <LoadFailure error={settlement.error} />
        ) : (
          <Section
            title={adminT("ops.partners.settlement")}
            actions={
              <Button size="sm" disabled={selected.length === 0 || !partner} onClick={() => setPaying(true)}>
                {adminT("ops.partners.record_payout_n", { n: selected.length })}
              </Button>
            }
          >
            <Card>
              <Details
                items={[
                  { label: adminT("ops.partners.unpaid_total"), value: idr(settlement.data.unpaid_total) },
                  { label: adminT("ops.partners.paid_total"), value: idr(settlement.data.paid_total) },
                  { label: adminT("ops.partners.selected_total"), value: idr(selectedTotal) },
                  { label: adminT("ops.partners.bank"), value: partner ? `${partner.bank_name} · ${partner.bank_account_number} · ${partner.bank_account_name}` : "" },
                ]}
              />
            </Card>
            {lines.length === 0 ? (
              <EmptyState title={adminT("ops.partners.no_lines")} />
            ) : (
              <>
                {unpaid.length > 0 && (
                  <Checkbox
                    label={adminT("ops.partners.select_all_unpaid")}
                    checked={selected.length === unpaid.length}
                    onChange={(e) => setSelected(e.target.checked ? unpaid.map((l) => l.booking_id) : [])}
                  />
                )}
                <DataTable
                  rows={lines}
                  rowKey={(l) => l.booking_id}
                  columns={[
                    {
                      key: "select",
                      header: adminT("ops.partners.pay"),
                      cell: (l) =>
                        l.payout_id ? (
                          <span className="text-xs text-muted">{adminT("ops.partners.paid")}</span>
                        ) : (
                          <input type="checkbox" aria-label={adminT("ops.partners.select_line", { number: l.booking_number })} checked={selected.includes(l.booking_id)} onChange={() => toggle(l.booking_id)} />
                        ),
                    },
                    {
                      key: "booking",
                      header: adminT("ops.bookings.number"),
                      primary: true,
                      cell: (l) => (
                        <Link to={`/admin/bookings/${l.booking_id}`} className="font-medium text-primary hover:underline">
                          {l.booking_number}
                        </Link>
                      ),
                    },
                    { key: "status", header: adminT("ops.bookings.status"), cell: (l) => <StatusBadge status={l.status} /> },
                    { key: "ends", header: adminT("ops.booking.ends"), cell: (l) => when(l.ends_at, ADMIN_TZ) },
                    { key: "basis", header: adminT("ops.partners.basis"), cell: (l) => idr(l.basis) },
                    { key: "commission", header: adminT("ops.partners.commission"), cell: (l) => idr(l.commission) },
                    { key: "refunded", header: adminT("ops.booking.refunded"), cell: (l) => idr(l.refunded) },
                    { key: "amount", header: adminT("ops.partners.partner_amount"), cell: (l) => idr(l.partner_amount) },
                  ]}
                />
              </>
            )}
          </Section>
        )}
      </Pending>

      <Section title={adminT("ops.partners.payouts")}>
        {loaderData.payouts.error ? (
          <LoadFailure error={loaderData.payouts.error} />
        ) : loaderData.payouts.data.length === 0 ? (
          <EmptyState title={adminT("ops.partners.no_payouts")} />
        ) : (
          <DataTable
            rows={loaderData.payouts.data}
            rowKey={(p) => p.id}
            columns={[
              { key: "partner", header: adminT("ops.partners.partner"), cell: (p) => p.partner_name ?? partners.find((x) => x.id === p.partner_id)?.name ?? "", primary: true },
              { key: "period", header: adminT("ops.partners.period"), cell: (p) => `${plainDate(p.period_start)} – ${plainDate(p.period_end)}` },
              { key: "amount", header: adminT("ops.payments.amount"), cell: (p) => idr(p.amount) },
              { key: "paid", header: adminT("ops.payment_dialog.paid_on"), cell: (p) => plainDate(p.paid_on) },
              {
                key: "proof",
                header: adminT("ops.proof.label"),
                cell: (p) =>
                  p.proof_media_id ? (
                    <a href={apiHref(`/admin/files/${p.proof_media_id}`)} target="_blank" rel="noopener" className="text-primary hover:underline">
                      {adminT("ops.proof.view")}
                    </a>
                  ) : (
                    "—"
                  ),
              },
              { key: "notes", header: adminT("ops.common.notes"), cell: (p) => p.notes || "—" },
            ]}
          />
        )}
      </Section>

      {partner && settlement?.data && (
        <PayoutDialog open={paying} onClose={() => setPaying(false)} partner={partner} start={query.start} end={query.end} bookingIds={selected} total={selectedTotal} />
      )}
      {partner && !partner.bank_account_number && <Alert tone="warning">{adminT("ops.partners.bank_missing")}</Alert>}
    </div>
  );
}
