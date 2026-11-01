// Fails when locale folders disagree on keys, so every user-facing string exists in every
// supported language. The admin namespace is English only.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../app/locales/", import.meta.url).pathname;
const locales = readdirSync(root);
const flatten = (o, p = "") => Object.entries(o).flatMap(([k, v]) => (typeof v === "object" && v !== null ? flatten(v, `${p}${k}.`) : [`${p}${k}`]));
let failed = false;
for (const ns of readdirSync(join(root, "en"))) {
  if (ns.startsWith("admin")) continue;
  const base = new Set(flatten(JSON.parse(readFileSync(join(root, "en", ns), "utf8"))));
  for (const loc of locales.filter((l) => l !== "en")) {
    const other = new Set(flatten(JSON.parse(readFileSync(join(root, loc, ns), "utf8"))));
    for (const k of base) if (!other.has(k)) { console.error(`${loc}/${ns}: missing ${k}`); failed = true; }
    for (const k of other) if (!base.has(k)) { console.error(`${loc}/${ns}: extra ${k}`); failed = true; }
  }
}
if (failed) process.exit(1);
console.log("locales consistent");
