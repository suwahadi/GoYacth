import { Link } from "react-router";

import { CompassIcon, DisplayHeading, Eyebrow, MapPinIcon, PHONE_IMAGE, ResponsiveImage } from "~/components/ui";
import { CtaLink } from "~/features/public/content";
import { localePath } from "~/lib/config";
import { useLocale, useT } from "~/lib/i18n";
import type { HomeSection, RegionCard } from "~/lib/types";

import { asArray } from "./sections";

const SHOWN_REGIONS = 4;

export function DestinationsBand({ section }: { section: HomeSection }) {
  const t = useT();
  const locale = useLocale();
  const regions = asArray<RegionCard>(section.data);
  const c = section.content;
  if (regions.length === 0) return null;
  const rowClass = "flex min-h-11 items-center gap-3 py-2 text-[0.9375rem] font-medium hover:underline";
  return (
    <section className="grid lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <ResponsiveImage image={section.image} sizes={`(min-width: 1024px) 55vw, (min-width: 640px) 100vw, ${PHONE_IMAGE}`} className="aspect-[5/2] w-full lg:aspect-auto lg:h-full lg:[mask-image:linear-gradient(to_right,black_78%,transparent)]" />
      <div className="flex flex-col gap-8 px-5 py-9 sm:flex-row sm:items-center sm:justify-between lg:gap-10 lg:py-11 lg:pl-4 lg:pr-[7.3vw]">
        <div className="max-w-[30rem]">
          {c.subtitle && <Eyebrow>{c.subtitle}</Eyebrow>}
          <DisplayHeading className="mt-3 text-[clamp(2rem,1rem+2.2vw,3.5rem)]">{c.title}</DisplayHeading>
          {c.body && <p className="mt-3 leading-relaxed text-muted xl:text-lg">{c.body}</p>}
          {c.cta_label && c.cta_url && (
            <p className="mt-6">
              <CtaLink label={c.cta_label} url={c.cta_url} pill arrow />
            </p>
          )}
        </div>
        <ul className="grid shrink-0 grid-cols-2 gap-x-6 sm:block sm:w-36 sm:divide-y xl:w-44 sm:divide-border">
          {regions.slice(0, SHOWN_REGIONS).map((r) => (
            <li key={r.id}>
              <Link to={localePath(locale, r.slug ? `/destinations/${r.slug}` : "/destinations")} className={rowClass}>
                <MapPinIcon className="size-5 shrink-0 text-accent-icon" />
                {r.name}
              </Link>
            </li>
          ))}
          <li>
            <Link to={localePath(locale, "/destinations")} className={rowClass}>
              <CompassIcon className="size-5 shrink-0 text-accent-icon" />
              {t("public.home.more_regions")}
            </Link>
          </li>
        </ul>
      </div>
    </section>
  );
}
