import { useState } from "react";
import { useSearchParams } from "react-router";

import type { Route } from "./+types/login";
import { Alert } from "~/components/ui";
import { SignInForm, type SignInMode, safeReturnPath, useSignInTitle } from "~/features/account/sign-in";
import { FormSection, PageHero } from "~/features/public/components";
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

// Checkout and account pages send signed-out visitors here; the header opens the same form in a popup.
export default function Login() {
  const t = useT();
  const tc = useTCode();
  const [params] = useSearchParams();
  const root = useRootData();
  const [mode, setMode] = useState<SignInMode>("login");
  const title = useSignInTitle(mode);
  const error = params.get("error");
  const returnTo = safeReturnPath(params.get("return_to"), localePath(root.locale, "/account"));
  if (root.user && typeof window !== "undefined") {
    window.location.replace(returnTo);
  }
  return (
    <>
      <PageHero title={title} crumbs={[{ name: t("public.breadcrumb.home"), path: "/" }, { name: title }]} width="max-w-md" />
      <FormSection>
        {error && (
          <Alert tone="danger" className="mb-5">
            {tc("validation.errors", error)}
          </Alert>
        )}
        <SignInForm mode={mode} onMode={setMode} returnTo={returnTo} />
      </FormSection>
    </>
  );
}
