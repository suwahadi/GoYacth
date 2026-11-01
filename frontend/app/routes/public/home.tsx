import type { Route } from "./+types/home";
import { Container } from "~/components/ui";
import { HomeFallback, HomeSectionView } from "~/features/public/content";
import { load, loadOptional, requestLocale, rootFromMatches, firstImageUrl } from "~/features/public/loaders";
import { translate } from "~/lib/i18n";
import { buildMeta, organizationLd } from "~/lib/seo";
import type { BoatCard, HomeSection } from "~/lib/types";

export async function loader({ request }: Route.LoaderArgs) {
  const locale = requestLocale(request);
  const sections = await load<HomeSection[]>("/home", request);
  const fallbackBoats = sections.length === 0 ? ((await loadOptional<BoatCard[]>("/boats", request, { per_page: 6 })) ?? []) : [];
  return { locale, sections, fallbackBoats };
}

export function meta({ loaderData, matches }: Route.MetaArgs) {
  const root = rootFromMatches(matches);
  const locale = loaderData?.locale ?? "en";
  const hero = loaderData?.sections.find((s) => s.type === "HERO");
  const seo = root?.settings.seo;
  return buildMeta({
    origin: root?.origin ?? "",
    locale,
    title: seo?.default_title || translate(locale, "public.home.title"),
    description: seo?.default_description || translate(locale, "public.home.description"),
    path: "/",
    image: firstImageUrl(hero?.image),
    jsonLd: [organizationLd(root?.origin ?? "", { email: root?.settings.site?.email, phone: root?.settings.site?.phone })],
  });
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { sections, fallbackBoats } = loaderData;
  if (sections.length === 0) return <HomeFallback boats={fallbackBoats} />;
  const firstHero = sections.findIndex((s) => s.type === "HERO");
  return (
    <Container className="pb-8">
      {firstHero === -1 && <h1 className="sr-only">{translate(loaderData.locale, "public.home.title")}</h1>}
      {sections.map((s, i) => (
        <HomeSectionView key={s.id} section={s} asH1={i === firstHero} />
      ))}
    </Container>
  );
}

export { PublicErrorBoundary as ErrorBoundary } from "~/features/public/components";
