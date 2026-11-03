import { type FormEvent, useState } from "react";
import { useSearchParams } from "react-router";

import type { Route } from "./+types/verify-email";
import { Alert, ApiErrorMessage, Button, Field, Input, useFieldErrors } from "~/components/ui";
import { safeReturnPath } from "~/features/account/sign-in";
import { FormSection, PageHero } from "~/features/public/components";
import { api } from "~/lib/api";
import { localePath, splitLocale } from "~/lib/config";
import { translate, useLocale, useT } from "~/lib/i18n";
import { noindexMeta } from "~/lib/seo";

export async function loader({ request }: Route.LoaderArgs) {
  return { locale: splitLocale(new URL(request.url).pathname).locale };
}

export function meta({ loaderData }: Route.MetaArgs) {
  return noindexMeta(translate(loaderData?.locale ?? "en", "common.auth.verify_title"));
}

// The owner of the inbox chooses the password here. Opening the link alone changes nothing, so mail
// scanners that follow links do not use it up.
export default function VerifyEmail() {
  const t = useT();
  const locale = useLocale();
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const returnTo = safeReturnPath(params.get("return_to"), localePath(locale, "/account"));
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const fe = useFieldErrors(error);

  async function confirm(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api("/auth/verify-email", { method: "POST", body: { token, password } });
      window.location.href = returnTo;
    } catch (err) {
      setError(err);
      setPending(false);
    }
  }

  const title = t("common.auth.verify_title");
  return (
    <>
      <PageHero title={title} crumbs={[{ name: t("public.breadcrumb.home"), path: "/" }, { name: title }]} width="max-w-md" />
      <FormSection>
        {token ? (
          <form onSubmit={confirm} className="space-y-4">
            <p className="text-muted">{t("common.auth.verify_body")}</p>
            <Field label={t("common.auth.password")} required error={fe["password"]} hint={t("common.auth.password_hint")}>
              {(p) => <Input {...p} type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} maxLength={72} autoComplete="new-password" />}
            </Field>
            <ApiErrorMessage error={error} />
            <Button type="submit" size="lg" full pending={pending}>
              {t("common.auth.verify_submit")}
            </Button>
          </form>
        ) : (
          <Alert tone="warning">{t("common.auth.link_missing")}</Alert>
        )}
      </FormSection>
    </>
  );
}
