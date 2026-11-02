import { useState } from "react";

import { Button, Field, Input, useFieldErrors, useToast } from "~/components/ui";
import { useAction } from "~/features/admin-ops/hooks";
import { OpsError, PageHeader } from "~/features/admin-ops/ui";
import { api } from "~/lib/api";
import { adminT } from "~/lib/i18n";

export function meta() {
  return [{ title: `${adminT("ops.account.title")} | GoYacht Admin` }];
}

export default function AccountPage() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const change = useAction();
  const fields = useFieldErrors(change.error);
  const toast = useToast();
  const submit = async () => {
    const r = await change.run(() => api("/auth/password", { method: "POST", body: { current_password: current, new_password: next } }));
    if (r.ok) {
      setCurrent("");
      setNext("");
      toast(adminT("ops.account.changed"));
    }
  };
  return (
    <div className="max-w-sm">
      <PageHeader title={adminT("ops.account.title")} />
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label={adminT("ops.account.current")}>
          {(p) => <Input {...p} type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />}
        </Field>
        <Field label={adminT("ops.account.next")} hint={adminT("ops.account.hint")} error={fields.new_password}>
          {(p) => <Input {...p} type="password" autoComplete="new-password" required value={next} onChange={(e) => setNext(e.target.value)} />}
        </Field>
        <OpsError error={change.error} />
        <Button type="submit" pending={change.pending}>
          {adminT("ops.account.submit")}
        </Button>
      </form>
    </div>
  );
}
