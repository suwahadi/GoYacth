import { useSearchParams } from "react-router";

import type { Route } from "./+types/login";
import { Alert, Container, buttonClass } from "~/components/ui";
import { localePath, splitLocale } from "~/lib/config";
import { translate, useT, useTCode } from "~/lib/i18n";
import { noindexMeta } from "~/lib/seo";
import { useRootData } from "~/root";

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
    <Container className="max-w-md py-16">
      <h1 className="text-2xl font-bold">{t("common.auth.login_title")}</h1>
      <p className="mt-2 text-muted">{t("common.auth.login_subtitle")}</p>
      {error && (
        <Alert tone="danger" className="mt-6">
          {tc("validation.errors", error)}
        </Alert>
      )}
      <a href={`/api/v1/auth/google?return_to=${encodeURIComponent(returnTo)}`} className={buttonClass("primary", "lg", true) + " mt-8"}>
        {t("common.auth.sign_in_google")}
      </a>
    </Container>
  );
}

