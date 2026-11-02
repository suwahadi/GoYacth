import { DisplayHeading, cn } from "~/components/ui";
import { CtaLink } from "~/features/public/content";
import type { HomeSection } from "~/lib/types";

import { homeWidth } from "./sections";

export function CtaBand({ section }: { section: HomeSection }) {
  const c = section.content;
  return (
    <section className="on-ink relative isolate overflow-hidden border-b border-ink-line bg-ink text-ink-fg">
      {/* Wake lines behind the band, the same water the hero opens with. */}
      <svg className="absolute inset-0 -z-10 size-full text-ink-fg/10" viewBox="0 0 1200 120" preserveAspectRatio="none" fill="none" stroke="currentColor" aria-hidden="true">
        <path d="M0 96C180 40 320 118 520 96s300-96 680-44" />
        <path d="M0 112c220-60 340 12 560-12s320-82 640-28" />
        <path d="M0 60c200 20 360 62 620 26S980 8 1200 30" />
      </svg>
      <div className={cn(homeWidth, "flex flex-col gap-5 py-7 md:flex-row xl:py-9 md:items-center md:justify-between")}>
        <div>
          <DisplayHeading className="text-[clamp(1.75rem,1rem+2vw,3.25rem)]">{c.title}</DisplayHeading>
          {(c.subtitle || c.body) && <p className="mt-1 xl:text-lg">{c.subtitle || c.body}</p>}
        </div>
        {c.cta_label && c.cta_url && (
          <p className="shrink-0">
            <CtaLink label={c.cta_label} url={c.cta_url} variant="accent" pill arrow />
          </p>
        )}
      </div>
    </section>
  );
}
