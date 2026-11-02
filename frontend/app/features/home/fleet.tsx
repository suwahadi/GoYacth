import { Link } from "react-router";

import { ArrowRightIcon, DisplayHeading, Eyebrow, ResponsiveImage, cn } from "~/components/ui";
import { CtaLink } from "~/features/public/content";
import { localePath } from "~/lib/config";
import { useLocale, useT } from "~/lib/i18n";
import type { BoatCard, HomeSection } from "~/lib/types";

import { asArray, homeWidth } from "./sections";

function FleetCard({ boat }: { boat: BoatCard }) {
  const t = useT();
  const locale = useLocale();
  return (
    <li>
      <Link to={localePath(locale, boat.slug ? `/boats/${boat.slug}` : "/boats")} className="on-ink group relative block aspect-[4/3] overflow-hidden rounded-xl bg-ink sm:aspect-[20/19]">
        <ResponsiveImage image={boat.thumbnail} sizes="(min-width: 1024px) 19vw, (min-width: 640px) 31vw, 100vw" className="size-full transition-transform duration-300 group-hover:scale-[1.03] motion-reduce:transform-none" />
        <span className="absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-ink via-ink/75 to-transparent" aria-hidden="true" />
        <span className="absolute inset-x-4 bottom-4 flex items-end justify-between gap-3 text-ink-fg">
          <span className="min-w-0">
            <span className="block text-lg font-medium leading-tight xl:text-xl">{boat.name}</span>
            <span className="mt-1 block text-sm text-ink-fg">{t("common.units.pax_max", { count: boat.max_passengers })}</span>
          </span>
          <span className="grid size-9 shrink-0 place-items-center rounded-full border border-ink-fg/80 transition-colors group-hover:border-accent group-hover:bg-accent group-hover:text-accent-fg" aria-hidden="true">
            <ArrowRightIcon className="size-4" />
          </span>
        </span>
      </Link>
    </li>
  );
}

export function FleetSection({ section }: { section: HomeSection }) {
  const boats = asArray<BoatCard>(section.data);
  const c = section.content;
  if (boats.length === 0) return null;
  return (
    <section className={cn(homeWidth, "grid items-center gap-8 pb-12 lg:grid-cols-[minmax(0,29%)_minmax(0,1fr)] lg:gap-6 lg:pb-14")}>
      <div>
        {c.subtitle && <Eyebrow>{c.subtitle}</Eyebrow>}
        <DisplayHeading className="mt-3 text-[clamp(2rem,1rem+2.2vw,3.5rem)]">{c.title}</DisplayHeading>
        {c.body && <p className="mt-3 leading-relaxed text-muted xl:text-lg">{c.body}</p>}
        {c.cta_label && c.cta_url && (
          <p className="mt-6">
            <CtaLink label={c.cta_label} url={c.cta_url} variant="accent" pill arrow />
          </p>
        )}
      </div>
      <ul className="grid gap-5 sm:grid-cols-3 sm:gap-4 lg:gap-5">
        {boats.map((b) => (
          <FleetCard key={b.id} boat={b} />
        ))}
      </ul>
    </section>
  );
}
