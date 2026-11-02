import { useState } from "react";
import { redirect, useSearchParams } from "react-router";

import type { Route } from "./+types/login";
import { Button, Field, Input } from "~/components/ui";
import { useAction } from "~/features/admin-ops/hooks";
import { OpsError } from "~/features/admin-ops/ui";
import { ApiError, api, apiData } from "~/lib/api";
import { adminT } from "~/lib/i18n";
import type { Me } from "~/lib/types";

// Only paths inside the panel are followed, so this page cannot be used as an open redirect.
export function adminReturnPath(raw: string | null): string {
  return raw?.startsWith("/admin/") ? raw : "/admin";
}

export async function loader({ request }: Route.LoaderArgs) {
  const me = await apiData<Me>("/auth/me", { request }).catch((e) => {
    if (e instanceof ApiError && e.status === 401) return null;
    throw e;
  });
  if (me?.role === "ADMIN") throw redirect(adminReturnPath(new URL(request.url).searchParams.get("return_to")));
  return null;
}

export function headers() {
  return { "Cache-Control": "private, no-store" };
}

export function meta() {
  return [{ title: `${adminT("ops.login.submit")} | GoYacht Admin` }, { name: "robots", content: "noindex, nofollow" }];
}

export default function AdminLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [params] = useSearchParams();
  const login = useAction();
  const submit = async () => {
    const r = await login.run(() => api("/auth/admin/login", { method: "POST", body: { email, password } }));
    // A full load lets the server render the panel with the new session cookie.
    if (r.ok) window.location.href = adminReturnPath(params.get("return_to"));
    else setPassword("");
  };
  return (
    <main data-theme="light" className="flex min-h-screen items-center justify-center bg-bg p-4 text-fg">
      <form
        className="w-full max-w-sm space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h1 className="text-xl font-bold text-primary">GoYacht {adminT("nav.admin")}</h1>
        <Field label={adminT("ops.people.email")}>
          {(p) => <Input {...p} type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />}
        </Field>
        <Field label={adminT("ops.login.password")}>
          {(p) => <Input {...p} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        <OpsError error={login.error} />
        <Button type="submit" full pending={login.pending}>
          {adminT("ops.login.submit")}
        </Button>
      </form>
    </main>
  );
}
