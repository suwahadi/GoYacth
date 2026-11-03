import { type FormEvent, useState } from "react";
import { useSearchParams } from "react-router";

import type { Route } from "./+types/reset-password";
import { Alert, ApiErrorMessage, Button, ButtonLink, Field, Input, useFieldErrors } from "~/components/ui";
import { FormSection, PageHero } from "~/features/public/components";
import { api } from "~/lib/api";
import { localePath, splitLocale } from "~/lib/config";
import { translate, useLocale, useT } from "~/lib/i18n";
import { noindexMeta } from "~/lib/seo";

export async function loader({ request }: Route.LoaderArgs) {
  return { locale: splitLocale(new URL(request.url).pathname).locale };
}

export function meta({ loaderData }: Route.MetaArgs) {
  return noindexMeta(translate(loaderData?.locale ?? "en", "common.auth.reset_title"));
}

export default function ResetPassword() {
  const t = useT();
  const locale = useLocale();
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);
  const fe = useFieldErrors(error);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api("/auth/password/reset", { method: "POST", body: { token, password } });
      setDone(true);
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  }

  const title = t("common.auth.reset_title");
  return (
    <>
      <PageHero title={title} crumbs={[{ name: t("public.breadcrumb.home"), path: "/" }, { name: title }]} width="max-w-md" />
      <FormSection>
        {!token ? (
          <Alert tone="warning">{t("common.auth.link_missing")}</Alert>
        ) : done ? (
          <div className="space-y-4">
            <Alert tone="success">{t("common.auth.reset_done")}</Alert>
            <ButtonLink to={localePath(locale, "/login")} size="lg" full>
              {t("common.auth.submit_login")}
            </ButtonLink>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <p className="text-muted">{t("common.auth.reset_body")}</p>
            <Field label={t("common.auth.new_password")} required error={fe["password"]} hint={t("common.auth.password_hint")}>
              {(p) => <Input {...p} type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} maxLength={72} autoComplete="new-password" />}
            </Field>
            <ApiErrorMessage error={error} />
            <Button type="submit" size="lg" full pending={pending}>
              {t("common.auth.reset_submit")}
            </Button>
          </form>
        )}
      </FormSection>
    </>
  );
}
