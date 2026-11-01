import { useState, type FormEvent } from "react";
import { useRevalidator } from "react-router";

import { ApiErrorMessage, Button, Card, Field, Input, Money, StatusBadge, useFieldErrors, useToast } from "~/components/ui";
import { api } from "~/lib/api";
import { formatDateTime } from "~/lib/format";
import { useLocale, useT, useTCode } from "~/lib/i18n";

import type { CustomerRefund } from "./types";

export function RefundsSection({ refunds, timezone }: { refunds: CustomerRefund[]; timezone: string }) {
  const t = useT();
  const tc = useTCode();
  const locale = useLocale();
  if (refunds.length === 0) return null;
  return (
    <Card>
      <h2 className="text-lg font-semibold">{t("account.refunds.title")}</h2>
      <ul className="mt-3 divide-y divide-border">
        {refunds.map((r) => (
          <li key={r.id} className="space-y-2 py-3 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <Money amount={r.amount} className="font-medium" />
                <p className="text-xs text-muted">{tc("account.refunds.channels", r.channel)}</p>
                {r.completed_at && <p className="text-xs text-muted">{t("account.refunds.completed_at", { time: formatDateTime(r.completed_at, timezone, locale) })}</p>}
                {r.bank_name && <p className="text-xs text-muted">{t("account.refunds.bank_to", { bank: r.bank_name, name: r.bank_account_name })}</p>}
              </div>
              <StatusBadge status={r.status} />
            </div>
            {r.needs_bank_details && <BankDetailsForm refundId={r.id} />}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function BankDetailsForm({ refundId }: { refundId: string }) {
  const t = useT();
  const toast = useToast();
  const revalidator = useRevalidator();
  const [bankName, setBankName] = useState("");
  const [accountName, setAccountName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const fe = useFieldErrors(error);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api(`/refunds/${refundId}/bank-details`, { method: "PUT", body: { bank_name: bankName, bank_account_name: accountName, bank_account_number: accountNumber } });
      toast(t("account.refunds.bank_saved"));
      revalidator.revalidate();
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-md border border-border p-3" noValidate>
      <p className="font-medium">{t("account.refunds.bank_title")}</p>
      <p className="text-xs text-muted">{t("account.refunds.bank_hint")}</p>
      <Field label={t("account.refunds.bank_name")} required error={fe["bank_name"]}>
        {(p) => <Input {...p} value={bankName} onChange={(e) => setBankName(e.target.value)} required maxLength={80} />}
      </Field>
      <Field label={t("account.refunds.account_name")} required error={fe["bank_account_name"]}>
        {(p) => <Input {...p} value={accountName} onChange={(e) => setAccountName(e.target.value)} required maxLength={120} />}
      </Field>
      <Field label={t("account.refunds.account_number")} required error={fe["bank_account_number"]}>
        {(p) => <Input {...p} value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} required inputMode="numeric" autoComplete="off" maxLength={40} />}
      </Field>
      <ApiErrorMessage error={error} />
      <Button type="submit" pending={pending}>
        {t("account.refunds.bank_submit")}
      </Button>
    </form>
  );
}
