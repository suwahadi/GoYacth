import { useState } from "react";
import { useRevalidator } from "react-router";

import type { Route } from "./+types/policies";
import { Button, DataTable, EmptyState, Tabs, useToast, type Column } from "~/components/ui";
import { loadRefs, settle } from "~/features/admin-catalog/data";
import { cancellationPolicyDTO, cancellationPolicyForm, paymentPolicyDTO, paymentPolicyForm, type CancellationPolicyForm, type PaymentPolicyForm, type TierRow } from "~/features/admin-catalog/mappers";
import type { CancellationPolicy, PaymentPolicy, RecordStatus } from "~/features/admin-catalog/types";
import {
  FormDialog,
  FormError,
  LoadFailed,
  MoneyField,
  NumberField,
  PageHeader,
  PercentField,
  SelectField,
  StatusPill,
  TextField,
  TextareaField,
  TranslationTabs,
  adminMeta,
  enumLabel,
  enumOptions,
  useSubmission,
  useTabParam,
} from "~/features/admin-catalog/ui";
import { api } from "~/lib/api";
import { DEFAULT_LOCALE, LOCALES, type Locale } from "~/lib/config";
import { formatBasisPoints, formatIDR } from "~/lib/format";
import { adminT } from "~/lib/i18n";

const TABS = ["payment", "cancellation"] as const;

export function meta() {
  return adminMeta("catalog.policies.title");
}

export async function loader({ request }: Route.LoaderArgs) {
  return { refs: await settle(loadRefs(request, ["paymentPolicies", "cancellationPolicies"])) };
}

export default function Policies({ loaderData }: Route.ComponentProps) {
  const [tab, setTab] = useTabParam(TABS);
  const { refs } = loaderData;
  return (
    <div className="space-y-4">
      <PageHeader title={adminT("catalog.policies.title")} />
      <Tabs tabs={TABS.map((t) => ({ id: t, label: adminT(`catalog.policies.tab_${t}`) }))} active={tab} onChange={(t) => setTab(t as (typeof TABS)[number])} />
      {!refs.ok ? <LoadFailed code={refs.code} /> : tab === "payment" ? <PaymentPolicies rows={refs.data.paymentPolicies} /> : <CancellationPolicies rows={refs.data.cancellationPolicies} />}
    </div>
  );
}

function depositText(p: PaymentPolicy) {
  if (p.type === "FULL") return enumLabel("payment_type", "FULL");
  const amount = p.deposit_type === "PERCENTAGE" ? formatBasisPoints(p.deposit_value, "en") : formatIDR(p.deposit_value, "en");
  return adminT("catalog.policies.deposit_summary", { amount, days: p.balance_due_days });
}

function PaymentPolicies({ rows }: { rows: PaymentPolicy[] }) {
  const [editing, setEditing] = useState<PaymentPolicy | "new" | null>(null);
  const rv = useRevalidator();
  const columns: Column<PaymentPolicy>[] = [
    { key: "name", header: adminT("catalog.fields.name"), primary: true, cell: (p) => p.name },
    { key: "terms", header: adminT("catalog.policies.terms"), cell: depositText },
    { key: "status", header: adminT("catalog.fields.status"), cell: (p) => <StatusPill status={p.status} /> },
    {
      key: "actions",
      header: adminT("catalog.common.actions"),
      cell: (p) => (
        <Button size="sm" variant="secondary" onClick={() => setEditing(p)}>
          {adminT("catalog.common.edit")}
        </Button>
      ),
    },
  ];
  return (
    <div className="space-y-3">
      <Button onClick={() => setEditing("new")}>{adminT("catalog.policies.new_payment")}</Button>
      <p className="text-xs text-muted">{adminT("catalog.policies.archive_hint")}</p>
      {rows.length === 0 ? <EmptyState title={adminT("catalog.common.empty")} /> : <DataTable rows={rows} columns={columns} rowKey={(p) => p.id} />}
      {editing && (
        <PaymentPolicyDialog
          policy={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            rv.revalidate();
          }}
        />
      )}
    </div>
  );
}

function PaymentPolicyDialog({ policy, onClose, onSaved }: { policy: PaymentPolicy | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<PaymentPolicyForm>(() => paymentPolicyForm(policy));
  const s = useSubmission();
  const toast = useToast();
  const set = (patch: Partial<PaymentPolicyForm>) => setForm((f) => ({ ...f, ...patch }));
  const save = async () => {
    const { dto, errors } = paymentPolicyDTO(form);
    if (Object.keys(errors).length) return s.invalid(errors);
    const ok = await s.run(async (signal) => {
      await api(policy ? `/admin/payment-policies/${policy.id}` : "/admin/payment-policies", { method: policy ? "PUT" : "POST", body: dto, signal });
    });
    if (ok) {
      toast(adminT("catalog.common.saved"));
      onSaved();
    }
  };
  return (
    <FormDialog id="payment-policy-form" title={policy ? policy.name : adminT("catalog.policies.new_payment")} pending={s.pending} onClose={onClose} onSubmit={() => void save()}>
      <TextField label={adminT("catalog.fields.name")} required value={form.name} onChange={(v) => set({ name: v })} error={s.field("name")} />
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField label={adminT("catalog.policies.payment_type")} value={form.type} onChange={(v) => set({ type: v as PaymentPolicyForm["type"] })} options={enumOptions("payment_type", ["FULL", "DEPOSIT"])} error={s.field("type")} />
        <SelectField label={adminT("catalog.fields.status")} value={form.status} onChange={(v) => set({ status: v as RecordStatus })} options={enumOptions("status", ["ACTIVE", "ARCHIVED"])} error={s.field("status")} />
        {form.type === "DEPOSIT" && (
          <>
            <SelectField label={adminT("catalog.policies.deposit_type")} value={form.deposit_type} onChange={(v) => set({ deposit_type: v as PaymentPolicyForm["deposit_type"] })} options={enumOptions("amount_type", ["PERCENTAGE", "FIXED"])} error={s.field("deposit_type")} />
            {form.deposit_type === "PERCENTAGE" ? (
              <PercentField label={adminT("catalog.policies.deposit_percent")} required value={form.deposit_value} onChange={(v) => set({ deposit_value: v })} error={s.field("deposit_value")} />
            ) : (
              <MoneyField label={adminT("catalog.policies.deposit_fixed")} required value={form.deposit_value} onChange={(v) => set({ deposit_value: v })} error={s.field("deposit_value")} />
            )}
            <NumberField label={adminT("catalog.policies.balance_due_days")} required value={form.balance_due_days} onChange={(v) => set({ balance_due_days: v })} error={s.field("balance_due_days")} hint={adminT("catalog.policies.balance_due_hint")} />
          </>
        )}
      </div>
      <FormError error={s.error} />
    </FormDialog>
  );
}

function CancellationPolicies({ rows }: { rows: CancellationPolicy[] }) {
  const [editing, setEditing] = useState<CancellationPolicy | "new" | null>(null);
  const rv = useRevalidator();
  const columns: Column<CancellationPolicy>[] = [
    { key: "name", header: adminT("catalog.fields.name"), primary: true, cell: (p) => p.name },
    {
      key: "tiers",
      header: adminT("catalog.policies.tiers"),
      cell: (p) => p.tiers.map((t) => adminT("catalog.policies.tier_summary", { days: t.min_days_before, refund: formatBasisPoints(t.refund_basis_points, "en") })).join(" · "),
    },
    { key: "status", header: adminT("catalog.fields.status"), cell: (p) => <StatusPill status={p.status} /> },
    {
      key: "actions",
      header: adminT("catalog.common.actions"),
      cell: (p) => (
        <Button size="sm" variant="secondary" onClick={() => setEditing(p)}>
          {adminT("catalog.common.edit")}
        </Button>
      ),
    },
  ];
  return (
    <div className="space-y-3">
      <Button onClick={() => setEditing("new")}>{adminT("catalog.policies.new_cancellation")}</Button>
      <p className="text-xs text-muted">{adminT("catalog.policies.archive_hint")}</p>
      {rows.length === 0 ? <EmptyState title={adminT("catalog.common.empty")} /> : <DataTable rows={rows} columns={columns} rowKey={(p) => p.id} />}
      {editing && (
        <CancellationPolicyDialog
          policy={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            rv.revalidate();
          }}
        />
      )}
    </div>
  );
}

function CancellationPolicyDialog({ policy, onClose, onSaved }: { policy: CancellationPolicy | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<CancellationPolicyForm>(() => cancellationPolicyForm(policy));
  const [locale, setLocale] = useState<Locale>(DEFAULT_LOCALE);
  const s = useSubmission();
  const toast = useToast();
  const set = (patch: Partial<CancellationPolicyForm>) => setForm((f) => ({ ...f, ...patch }));
  const setTier = (i: number, patch: Partial<TierRow>) => set({ tiers: form.tiers.map((t, j) => (j === i ? { ...t, ...patch } : t)) });
  const save = async () => {
    const { dto, errors } = cancellationPolicyDTO(form);
    if (Object.keys(errors).length) return s.invalid(errors);
    const ok = await s.run(async (signal) => {
      await api(policy ? `/admin/cancellation-policies/${policy.id}` : "/admin/cancellation-policies", { method: policy ? "PUT" : "POST", body: dto, signal });
    });
    if (ok) {
      toast(adminT("catalog.common.saved"));
      onSaved();
    }
  };
  const issues = LOCALES.filter((l) => !form.descriptions[l].trim() || !!s.field(`descriptions.${l}`));
  return (
    <FormDialog id="cancellation-policy-form" title={policy ? policy.name : adminT("catalog.policies.new_cancellation")} pending={s.pending} onClose={onClose} onSubmit={() => void save()}>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label={adminT("catalog.fields.name")} required value={form.name} onChange={(v) => set({ name: v })} error={s.field("name")} />
        <SelectField label={adminT("catalog.fields.status")} value={form.status} onChange={(v) => set({ status: v as RecordStatus })} options={enumOptions("status", ["ACTIVE", "ARCHIVED"])} error={s.field("status")} />
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{adminT("catalog.policies.tiers")}</legend>
        <p className="text-xs text-muted">{adminT("catalog.policies.tiers_hint")}</p>
        {s.field("tiers") && (
          <p role="alert" className="text-sm text-danger">
            {s.field("tiers")}
          </p>
        )}
        <ul className="space-y-2">
          {form.tiers.map((t, i) => (
            <li key={t.key} className="grid items-end gap-3 sm:grid-cols-3">
              <NumberField label={adminT("catalog.policies.min_days_before")} value={t.min_days_before} onChange={(v) => setTier(i, { min_days_before: v })} error={s.field(`tiers.${i}.min_days_before`)} />
              <PercentField label={adminT("catalog.policies.refund_percent")} value={t.refund_percent} onChange={(v) => setTier(i, { refund_percent: v })} error={s.field(`tiers.${i}.refund_percent`)} />
              <Button variant="secondary" disabled={form.tiers.length <= 1} onClick={() => set({ tiers: form.tiers.filter((_, j) => j !== i) })}>
                {adminT("catalog.common.remove")}
              </Button>
            </li>
          ))}
        </ul>
        <Button size="sm" variant="secondary" disabled={form.tiers.length >= 10} onClick={() => set({ tiers: [...form.tiers, { key: crypto.randomUUID(), min_days_before: "", refund_percent: "" }] })}>
          {adminT("catalog.policies.add_tier")}
        </Button>
      </fieldset>
      <TranslationTabs active={locale} onChange={setLocale} issues={issues} />
      <TextareaField
        label={adminT("catalog.policies.description")}
        rows={5}
        value={form.descriptions[locale]}
        onChange={(v) => set({ descriptions: { ...form.descriptions, [locale]: v } })}
        error={s.field(`descriptions.${locale}`)}
        hint={adminT("catalog.policies.description_hint")}
      />
      <FormError error={s.error} />
    </FormDialog>
  );
}
