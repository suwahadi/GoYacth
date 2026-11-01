import { data } from "react-router";

import { ButtonLink, Container } from "~/components/ui";
import { localePath } from "~/lib/config";
import { useLocale, useT } from "~/lib/i18n";
import { noindexMeta } from "~/lib/seo";

export function loader() {
  return data(null, { status: 404 });
}

export function meta() {
  return noindexMeta("404");
}

export default function NotFound() {
  const t = useT();
  const locale = useLocale();
  return (
    <Container className="py-24 text-center">
      <h1 className="text-2xl font-bold">{t("common.states.not_found_title")}</h1>
      <p className="mt-3 text-muted">{t("common.states.not_found_body")}</p>
      <ButtonLink to={localePath(locale, "/")} className="mt-6">
        {t("common.states.go_home")}
      </ButtonLink>
    </Container>
  );
}
