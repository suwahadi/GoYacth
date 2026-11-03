import { useSearchParams } from "react-router";

import type { Route } from "./+types/login";
import { Alert, Container, buttonClass } from "~/components/ui";
import { localePath, splitLocale } from "~/lib/config";
import { translate, useT, useTCode } from "~/lib/i18n";
import { noindexMeta } from "~/lib/seo";
import { useRootData } from "~/root";
import { PageHero } from "~/features/public/components";

export async function loader({ request }: Route.LoaderArgs) {
  return { locale: splitLocale(new URL(request.url).pathname).locale };
}

export function meta({ loaderData }: Route.MetaArgs) {
  return noindexMeta(translate(loaderData?.locale ?? "en", "common.auth.sign_in"));
}


export default function Login() {
  const t = useT();
  const tc = useTCode();
  const [params] = useSearchParams();
  const root = useRootData();
  const error = params.get("error");
  const returnTo = params.get("return_to") ?? localePath(root.locale, "/account");
  if (root.user && typeof window !== "undefined") {
    window.location.replace(returnTo);
  }
  return (
    <>
      <PageHero title={t("common.auth.login_title")} crumbs={[{ name: t("public.breadcrumb.home"), path: "/" }, { name: t("common.auth.login_title") }]} width="max-w-md" />
      <Container className="max-w-md pb-8 pt-6">
        <p className="text-muted">{t("common.auth.login_subtitle")}</p>
        {error && (
          <Alert tone="danger" className="mt-6">
            {tc("validation.errors", error)}
          </Alert>
        )}
        <a href={`/api/v1/auth/google?return_to=${encodeURIComponent(returnTo)}`} className={buttonClass("primary", "lg", true) + " mt-8"}>
          {t("common.auth.sign_in_google")}
        </a>
      </Container>
    </>
  );
}

