import { useCallback, useEffect, useRef, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { Link, useRevalidator, useSearchParams } from "react-router";

import { Badge, Button, ButtonPair, Checkbox, ConfirmDialog, Dialog, ErrorState, Field, Input, Select, Tabs, Textarea, useToast } from "~/components/ui";
import { ApiError } from "~/lib/api";
import { LOCALES, type Locale } from "~/lib/config";
import { formatBasisPoints, formatIDR } from "~/lib/format";
import { adminT, useTCode, type AdminKey, type Vars } from "~/lib/i18n";

import { parseWhole, percentToBasisPoints, type FieldCodes } from "./convert";

// ct translates keys assembled at runtime (enum values, error codes) inside the catalog
// namespace and returns null when no translation exists.
export function ct(key: string, vars?: Vars): string | null {
  const full = `catalog.${key}`;
  const msg = adminT(full as AdminKey, vars);
  return msg === full ? null : msg;
}

export function enumLabel(group: string, value: string): string {
  return ct(`enums.${group}.${value}`) ?? value;
}

export function localeLabel(loc: Locale): string {
  return ct(`locales.${loc}`) ?? loc.toUpperCase();
}

export function adminMeta(titleKey: AdminKey) {
  return [{ title: `${adminT(titleKey)} | GoYacht Admin` }, { name: "robots", content: "noindex, nofollow" }];
}

export function useErrorText() {
  const tc = useTCode();
  return useCallback(
    (err: unknown): string => {
      if (err instanceof ApiError) {
        const own = ct(`errors.${err.code}`);
        if (own) return own;
        const shared = tc("validation.errors", err.code);
        if (shared !== err.code) return shared;
      }
      return tc("validation.errors", "UNKNOWN");
    },
    [tc],
  );
}

export function useFieldText() {
  const tc = useTCode();
  return useCallback(
    (code: string): string => {
      const own = ct(`field_errors.${code}`);
      if (own) return own;
      const shared = tc("validation.fields", code);
      return shared === code ? tc("validation.fields", "INVALID") : shared;
    },
    [tc],
  );
}

export interface Submission {
  pending: boolean;
  error: unknown;
  codes: FieldCodes;
  field: (path: string) => string | undefined;
  under: (prefix: string) => string | undefined;
  run: (task: (signal: AbortSignal) => Promise<void>) => Promise<boolean>;
  invalid: (codes: FieldCodes) => void;
  reset: () => void;
}

// useSubmission tracks one form's request: pending flag, API or local field errors (dotted
// paths), and cancellation of an obsolete request when a new one starts or the form unmounts.
export function useSubmission(): Submission {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [codes, setCodes] = useState<FieldCodes>({});
  const ctrl = useRef<AbortController | null>(null);
  const text = useFieldText();
  useEffect(() => () => ctrl.current?.abort(), []);
  const run = useCallback(async (task: (signal: AbortSignal) => Promise<void>) => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setPending(true);
    setError(null);
    setCodes({});
    try {
      await task(c.signal);
      return true;
    } catch (e) {
      if ((e as Error).name === "AbortError") return false;
      setError(e);
      if (e instanceof ApiError) setCodes(e.fields);
      return false;
    } finally {
      if (ctrl.current === c) setPending(false);
    }
  }, []);
  const invalid = useCallback((c: FieldCodes) => {
    setCodes(c);
    setError(new ApiError(422, "VALIDATION_FAILED", "local validation", c));
  }, []);
  const reset = useCallback(() => {
    setCodes({});
    setError(null);
  }, []);
  const field = (path: string) => (codes[path] ? text(codes[path]) : undefined);
  const under = (prefix: string) => {
    const k = Object.keys(codes).find((p) => p === prefix || p.startsWith(`${prefix}.`));
    return k ? text(codes[k]) : undefined;
  };
  return { pending, error, codes, field, under, run, invalid, reset };
}

export function FormError({ error }: { error: unknown }) {
  const text = useErrorText();
  if (!error) return null;
  return (
    <p role="alert" className="rounded-md border border-danger bg-danger-bg px-3 py-2 text-sm text-danger">
      {text(error)}
    </p>
  );
}

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value">;

export function TextField({ label, value, onChange, error, hint, required, className, ...rest }: InputProps & { label: string; value: string; onChange: (v: string) => void; error?: string; hint?: string }) {
  return (
    <Field label={label} error={error} hint={hint} required={required} className={className}>
      {(p) => <Input {...p} {...rest} required={required} value={value} onChange={(e) => onChange(e.target.value)} />}
    </Field>
  );
}

export function NumberField(props: InputProps & { label: string; value: string; onChange: (v: string) => void; error?: string; hint?: string }) {
  return <TextField inputMode="numeric" autoComplete="off" {...props} />;
}

export function MoneyField({ hint, ...props }: InputProps & { label: string; value: string; onChange: (v: string) => void; error?: string; hint?: string }) {
  const n = parseWhole(props.value);
  return <TextField inputMode="numeric" autoComplete="off" {...props} hint={n !== null ? formatIDR(n, "en") : (hint ?? adminT("catalog.common.money_hint"))} />;
}

export function PercentField(props: InputProps & { label: string; value: string; onChange: (v: string) => void; error?: string }) {
  const bp = percentToBasisPoints(props.value);
  return <TextField inputMode="decimal" autoComplete="off" {...props} hint={bp !== null ? formatBasisPoints(bp, "en") : adminT("catalog.common.percent_hint")} />;
}

export function TextareaField({ label, value, onChange, error, hint, required, className, ...rest }: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange" | "value"> & { label: string; value: string; onChange: (v: string) => void; error?: string; hint?: string }) {
  return (
    <Field label={label} error={error} hint={hint} required={required} className={className}>
      {(p) => <Textarea {...p} {...rest} value={value} onChange={(e) => onChange(e.target.value)} />}
    </Field>
  );
}

export function SelectField({
  label,
  value,
  onChange,
  options,
  error,
  hint,
  required,
  placeholder,
  className,
  ...rest
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, "onChange" | "value"> & {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  error?: string;
  hint?: string;
  placeholder?: string;
}) {
  return (
    <Field label={label} error={error} hint={hint} required={required} className={className}>
      {(p) => (
        <Select {...p} {...rest} value={value} onChange={(e) => onChange(e.target.value)}>
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

export function enumOptions(group: string, values: readonly string[]) {
  return values.map((v) => ({ value: v, label: enumLabel(group, v) }));
}

export function CheckboxGroup({ legend, options, value, onChange, error }: { legend: string; options: { value: string; label: string }[]; value: string[]; onChange: (v: string[]) => void; error?: string }) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{legend}</legend>
      {options.length === 0 ? (
        <p className="text-sm text-muted">{adminT("catalog.common.none_available")}</p>
      ) : (
        <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
          {options.map((o) => (
            <Checkbox
              key={o.value}
              label={o.label}
              checked={value.includes(o.value)}
              onChange={(e) => onChange(e.target.checked ? [...value, o.value] : value.filter((v) => v !== o.value))}
            />
          ))}
        </div>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
    </fieldset>
  );
}

export function TranslationTabs({ active, onChange, issues }: { active: Locale; onChange: (l: Locale) => void; issues: Locale[] }) {
  return (
    <Tabs
      active={active}
      onChange={(id) => onChange(id as Locale)}
      tabs={LOCALES.map((l) => ({ id: l, label: issues.includes(l) ? adminT("catalog.common.locale_incomplete", { locale: localeLabel(l) }) : localeLabel(l) }))}
    />
  );
}

export function Section({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="space-y-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function PageHeader({ title, back, actions }: { title: string; back?: { to: string; label: string }; actions?: ReactNode }) {
  return (
    <header className="mb-4 space-y-1">
      {back && (
        <Link to={back.to} className="text-sm text-primary hover:underline">
          {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{title}</h1>
        {actions}
      </div>
    </header>
  );
}

const tones: Record<string, "success" | "warning" | "danger" | "neutral" | "info"> = {
  PUBLISHED: "success",
  ACTIVE: "success",
  READY: "success",
  DRAFT: "neutral",
  ARCHIVED: "neutral",
  INACTIVE: "neutral",
  PENDING: "warning",
  PROCESSING: "info",
  REJECTED: "danger",
  FAILED: "danger",
};

export function StatusPill({ status }: { status: string }) {
  return <Badge tone={tones[status] ?? "neutral"}>{enumLabel("status", status)}</Badge>;
}

// DeleteAction asks for confirmation and shows the API's refusal (for example a boat with
// bookings) inside the dialog instead of failing silently.
export function DeleteAction({ label, title, body, onDelete, size = "md" }: { label?: string; title: string; body: string; onDelete: (signal: AbortSignal) => Promise<void>; size?: "sm" | "md" }) {
  const [open, setOpen] = useState(false);
  const s = useSubmission();
  const toast = useToast();
  const text = useErrorText();
  return (
    <>
      <Button variant="danger" size={size} onClick={() => setOpen(true)}>
        {label ?? adminT("catalog.common.delete")}
      </Button>
      <ConfirmDialog
        open={open}
        title={title}
        tone="danger"
        pending={s.pending}
        confirmLabel={adminT("catalog.common.delete")}
        onClose={() => {
          setOpen(false);
          s.reset();
        }}
        onConfirm={async () => {
          const ok = await s.run(onDelete);
          if (ok) {
            setOpen(false);
            toast(adminT("catalog.common.deleted"));
          }
        }}
        body={
          <div className="space-y-2">
            <p>{body}</p>
            {s.error ? (
              <p role="alert" className="text-danger">
                {text(s.error)}
              </p>
            ) : null}
          </div>
        }
      />
    </>
  );
}

// useTabParam keeps the active tab in the query string without triggering loader revalidation.
export function useTabParam<T extends string>(tabs: readonly T[], param = "tab"): [T, (t: T) => void] {
  const [params] = useSearchParams();
  const [tab, setTab] = useState<T>(() => {
    const v = params.get(param) as T | null;
    return v && tabs.includes(v) ? v : tabs[0];
  });
  const change = (t: T) => {
    setTab(t);
    const url = new URL(window.location.href);
    url.searchParams.set(param, t);
    window.history.replaceState(window.history.state, "", url);
  };
  return [tab, change];
}

export function LoadFailed({ code }: { code: string }) {
  const text = useErrorText();
  const rv = useRevalidator();
  return <ErrorState message={text(new ApiError(0, code, "load failed"))} onRetry={() => rv.revalidate()} />;
}

// FormDialog keeps the submit button in the dialog footer while the <form> lives in the body.
export function FormDialog({ id, title, pending, onClose, onSubmit, children, size = "lg" }: { id: string; title: string; pending: boolean; onClose: () => void; onSubmit: () => void; children: ReactNode; size?: "sm" | "md" | "lg" }) {
  return (
    <Dialog
      open
      size={size}
      onClose={onClose}
      title={title}
      footer={
        <ButtonPair>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            {adminT("catalog.common.cancel")}
          </Button>
          <Button type="submit" form={id} pending={pending}>
            {adminT("catalog.common.save")}
          </Button>
        </ButtonPair>
      }
    >
      <form
        id={id}
        noValidate
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        {children}
      </form>
    </Dialog>
  );
}

