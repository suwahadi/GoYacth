export type DiffKind = "added" | "removed" | "changed" | "same";

export interface DiffRow {
  path: string;
  kind: DiffKind;
  before?: string;
  after?: string;
}

function flatten(value: unknown, prefix: string, out: Map<string, string>) {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0 && prefix) out.set(prefix, "{}");
    for (const [k, v] of entries) flatten(v, prefix ? `${prefix}.${k}` : k, out);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length === 0 && prefix) out.set(prefix, "[]");
    value.forEach((v, i) => flatten(v, `${prefix}[${i}]`, out));
    return;
  }
  out.set(prefix || "(value)", value === undefined ? "" : JSON.stringify(value));
}

// diffJson compares audit before/after snapshots leaf by leaf so nested changes stay readable.
export function diffJson(before: unknown, after: unknown): DiffRow[] {
  const b = new Map<string, string>();
  const a = new Map<string, string>();
  if (before !== null && before !== undefined) flatten(before, "", b);
  if (after !== null && after !== undefined) flatten(after, "", a);
  const paths = [...new Set([...b.keys(), ...a.keys()])].sort();
  return paths.map((path) => {
    const bv = b.get(path);
    const av = a.get(path);
    const kind: DiffKind = bv === undefined ? "added" : av === undefined ? "removed" : bv === av ? "same" : "changed";
    return { path, kind, before: bv, after: av };
  });
}
