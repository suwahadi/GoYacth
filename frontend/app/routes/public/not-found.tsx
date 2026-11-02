import { data } from "react-router";

import { ButtonLink, Container } from "~/components/ui";
import { localePath } from "~/lib/config";
import { useLocale, useT } from "~/lib/i18n";
import { noindexMeta } from "~/lib/seo";
import { PageHero } from "~/features/public/components";

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
    <>
      <PageHero title={t("common.states.not_found_title")} crumbs={[{ name: t("public.breadcrumb.home"), path: "/" }, { name: t("common.states.not_found_title") }]} />
      <Container className="py-12 text-center">
        <p className="text-muted">{t("common.states.not_found_body")}</p>
        <ButtonLink to={localePath(locale, "/")} className="mt-6">
          {t("common.states.go_home")}
        </ButtonLink>
      </Container>
    </>
  );
}
