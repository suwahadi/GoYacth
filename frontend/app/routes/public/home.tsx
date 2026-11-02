import type { Route } from "./+types/home";
import { homeFallback } from "~/features/home/fallback";
import { HomePage } from "~/features/home/home-page";
import { firstImageUrl, load, loadOptional, requestLocale, rootFromMatches } from "~/features/public/loaders";
import { translate } from "~/lib/i18n";
import { buildMeta, organizationLd } from "~/lib/seo";
import type { BoatCard, HomeSection, RegionCard } from "~/lib/types";

export async function loader({ request }: Route.LoaderArgs) {
  const locale = requestLocale(request);
  const cms = await load<HomeSection[]>("/home", request);
  if (cms.length > 0) return { locale, sections: cms };
  const [boats, regions] = await Promise.all([loadOptional<BoatCard[]>("/boats", request, { per_page: 3 }), loadOptional<RegionCard[]>("/regions", request)]);
  return { locale, sections: await homeFallback(locale, { boats: boats ?? [], regions: regions ?? [] }) };
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
  return <HomePage sections={loaderData.sections} />;
}

export { PublicErrorBoundary as ErrorBoundary } from "~/features/public/components";
