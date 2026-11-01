// Conversions between form text and API integers. Money is whole rupiah and percentages are basis
// points (10000 = 100%), so every conversion works on integer digits and never on floats.

const PERCENT = /^(\d{1,5})(?:[.,](\d{1,2}))?$/;

export function percentToBasisPoints(input: string): number | null {
  const m = PERCENT.exec(input.trim());
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}

export function basisPointsToPercent(bp: number): string {
  const whole = Math.floor(bp / 100);
  const frac = bp % 100;
  if (frac === 0) return String(whole);
  return `${whole}.${String(frac).padStart(2, "0").replace(/0$/, "")}`;
}

const CLOCK = /^(\d{1,2}):(\d{2})$/;

// clockToMinutes accepts 00:00–24:00; 24:00 is a valid closing time (end of day).
export function clockToMinutes(input: string): number | null {
  const m = CLOCK.exec(input.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (min > 59 || h > 24 || (h === 24 && min !== 0)) return null;
  return h * 60 + min;
}

const GROUPED = /^\d{1,3}(?:[.,\s]\d{3})+$/;

export function parseWhole(input: string): number | null {
  const s = input.trim();
  let digits: string;
  if (/^\d+$/.test(s)) digits = s;
  else if (GROUPED.test(s)) digits = s.replace(/[.,\s]/g, "");
  else return null;
  const n = Number(digits);
  return Number.isSafeInteger(n) ? n : null;
}

export function intText(n: number | null | undefined): string {
  return n === null || n === undefined ? "" : String(n);
}

export function linesToList(text: string): string[] {
  return text
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function localInputToIso(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export type FieldCodes = Record<string, string>;

// FieldReader parses form strings into DTO values and records failures under the same dotted
// paths the API uses, so local and server errors render through one mechanism.
export class FieldReader {
  errors: FieldCodes = {};

  private fail(path: string, code: string) {
    if (!this.errors[path]) this.errors[path] = code;
  }

  get ok(): boolean {
    return Object.keys(this.errors).length === 0;
  }

  int(path: string, input: string): number {
    if (!input.trim()) {
      this.fail(path, "REQUIRED");
      return 0;
    }
    const n = parseWhole(input);
    if (n === null) this.fail(path, "INVALID");
    return n ?? 0;
  }

  optInt(path: string, input: string): number | null {
    if (!input.trim()) return null;
    const n = parseWhole(input);
    if (n === null) this.fail(path, "INVALID");
    return n;
  }

  percent(path: string, input: string): number {
    if (!input.trim()) {
      this.fail(path, "REQUIRED");
      return 0;
    }
    const bp = percentToBasisPoints(input);
    if (bp === null || bp > 10000) this.fail(path, "OUT_OF_RANGE");
    return bp ?? 0;
  }

  clock(path: string, input: string): number {
    const m = clockToMinutes(input);
    if (m === null) this.fail(path, "INVALID");
    return m ?? 0;
  }

  required(path: string, value: string | null | undefined): string {
    if (!value) this.fail(path, "REQUIRED");
    return value ?? "";
  }

  coord(path: string, input: string, limit: number): number | null {
    const s = input.trim();
    if (!s) return null;
    const n = /^-?\d{1,3}(?:\.\d{1,8})?$/.test(s) ? Number(s) : NaN;
    if (Number.isNaN(n) || Math.abs(n) > limit) {
      this.fail(path, "OUT_OF_RANGE");
      return null;
    }
    return n;
  }
}
