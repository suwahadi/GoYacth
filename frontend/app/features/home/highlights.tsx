import { DisplayHeading, Eyebrow, HighlightIcon, ResponsiveImage, cn } from "~/components/ui";
import { useT } from "~/lib/i18n";
import type { HomeSection } from "~/lib/types";

import { homeWidth } from "./sections";

export function TrustStrip({ section }: { section: HomeSection }) {
  const t = useT();
  const items = section.content.items ?? [];
  if (items.length === 0) return null;
  return (
    <section aria-label={t("public.home.highlights_label")} className={cn(homeWidth, "py-10 lg:py-12")}>
      <ul className="grid grid-cols-2 gap-y-8 lg:flex lg:divide-x lg:divide-border">
        {items.map((it) => (
          <li key={it.title} className="flex flex-1 flex-col items-center px-3 text-center">
            <HighlightIcon name={it.icon} className="size-10 text-accent-icon" />
            <p className="mt-3 font-semibold xl:text-lg">{it.title}</p>
            {it.text && <p className="mt-0.5 text-sm text-muted">{it.text}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}

// A HIGHLIGHTS section with a photo reads as the longer "why us" story; without one it is the
// compact strip under the search bar.
export function WhySection({ section }: { section: HomeSection }) {
  const c = section.content;
  return (
    <section className={cn(homeWidth, "grid items-center gap-8 py-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,47%)] lg:gap-10 lg:py-12")}>
      <div>
        {c.subtitle && <Eyebrow>{c.subtitle}</Eyebrow>}
        <DisplayHeading className="mt-3 text-[clamp(2rem,1rem+2.2vw,3.5rem)]">{c.title}</DisplayHeading>
        {c.body && <p className="mt-2 text-lg text-muted xl:text-xl">{c.body}</p>}
        <ul className="mt-7 grid grid-cols-2 gap-y-6 sm:flex sm:divide-x sm:divide-border">
          {(c.items ?? []).map((it) => (
            <li key={it.title} className="flex flex-1 flex-col items-center px-2 text-center">
              <HighlightIcon name={it.icon} className="size-8 text-primary" />
              <p className="mt-2 text-sm font-semibold leading-tight">{it.title}</p>
              {it.text && <p className="mt-0.5 text-sm text-muted">{it.text}</p>}
            </li>
          ))}
        </ul>
      </div>
      <div className="overflow-hidden rounded-2xl lg:rounded-l-none">
        {/* The slanted edge repeats the bow line of the hero yacht. */}
        <ResponsiveImage image={section.image} sizes="(min-width: 1024px) 45vw, 100vw" className="aspect-[5/2] w-full lg:aspect-[8/3] lg:[clip-path:polygon(6%_0,100%_0,100%_100%,0_100%)]" />
      </div>
    </section>
  );
}
