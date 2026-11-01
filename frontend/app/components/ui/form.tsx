import { forwardRef, useId, useMemo, useRef, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

import { DIAL_CODES } from "~/lib/countries";
import { countryName } from "~/lib/format";
import { useLocale, useT } from "~/lib/i18n";

import { cn } from "./cn";

const control =
  "w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg placeholder:text-muted disabled:opacity-60 aria-[invalid=true]:border-danger";

export interface FieldProps {
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: (props: { id: string; "aria-invalid"?: boolean; "aria-describedby"?: string }) => ReactNode;
  className?: string;
}

// Field wires a label, hint and error message to its control for screen readers.
export function Field({ label, error, hint, required, children, className }: FieldProps) {
  const id = useId();
  const t = useT();
  const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("space-y-1", className)}>
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
        {required && (
          <span className="text-danger" aria-label={t("common.a11y.required")}>
            {" "}
            *
          </span>
        )}
      </label>
      {children({ id, "aria-invalid": error ? true : undefined, "aria-describedby": describedBy })}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cn(control, "h-10", className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cn(control, "min-h-24", className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return (
    <select ref={ref} className={cn(control, "h-10 pr-8", className)} {...rest}>
      {children}
    </select>
  );
});

export function Checkbox({ label, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return (
    <label className={cn("flex items-start gap-2 text-sm", className)}>
      <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]" {...rest} />
      <span>{label}</span>
    </label>
  );
}

export interface Option {
  value: string;
  label: string;
}

// SearchableSelect is an accessible combobox for long lists such as countries.
export function SearchableSelect({
  id,
  value,
  onChange,
  options,
  placeholder,
  invalid,
  describedBy,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  options: Option[];
  placeholder?: string;
  invalid?: boolean;
  describedBy?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const selected = options.find((o) => o.value === value);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase() === q) : options;
  }, [options, query]);
  const choose = (o: Option) => {
    onChange(o.value);
    setQuery("");
    setOpen(false);
  };
  return (
    <div className="relative">
      <input
        ref={inputRef}
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className={cn(control, "h-10")}
        placeholder={placeholder}
        value={open ? query : (selected?.label ?? "")}
        onFocus={() => {
          setOpen(true);
          setActive(0);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, filtered.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter" && open && filtered[active]) {
            e.preventDefault();
            choose(filtered[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {open && filtered.length > 0 && (
        <ul id={listId} role="listbox" className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-md border border-border bg-surface py-1 shadow-lg">
          {filtered.slice(0, 200).map((o, i) => (
            <li
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              className={cn("cursor-pointer px-3 py-2 text-sm", i === active && "bg-surface-2", o.value === value && "font-semibold")}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(o);
              }}
              onMouseEnter={() => setActive(i)}
            >
              {o.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function useCountryOptions(codes: string[]): Option[] {
  const locale = useLocale();
  return useMemo(
    () => codes.map((c) => ({ value: c, label: countryName(c, locale) })).sort((a, b) => a.label.localeCompare(b.label, locale)),
    [codes, locale],
  );
}

// PhoneInput collects an E.164 number from a calling code and a local number.
export function PhoneInput({ id, value, onChange, invalid, describedBy }: { id?: string; value: string; onChange: (v: string) => void; invalid?: boolean; describedBy?: string }) {
  const locale = useLocale();
  const t = useT();
  const match = DIAL_CODES.slice()
    .sort((a, b) => b.dial.length - a.dial.length)
    .find((d) => value.startsWith(d.dial));
  const [dial, setDial] = useState(match?.dial ?? "+62");
  const local = match ? value.slice(match.dial.length) : value.replace(/^\+/, "");
  const set = (d: string, l: string) => {
    const digits = l.replace(/[^0-9]/g, "").replace(/^0+/, "");
    onChange(digits ? `${d}${digits}` : "");
  };
  return (
    <div className="flex gap-2">
      <select
        aria-label={t("common.phone.country_code")}
        className={cn(control, "h-10 w-28 shrink-0")}
        value={dial}
        onChange={(e) => {
          setDial(e.target.value);
          set(e.target.value, local);
        }}
      >
        {DIAL_CODES.map((d) => (
          <option key={`${d.code}${d.dial}`} value={d.dial}>
            {d.code} {d.dial}
          </option>
        ))}
      </select>
      <input
        id={id}
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        lang={locale}
        className={cn(control, "h-10")}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        value={local}
        onChange={(e) => set(dial, e.target.value)}
        placeholder="812 3456 7890"
      />
    </div>
  );
}
