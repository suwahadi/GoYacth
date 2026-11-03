import { ButtonLink, CarouselArrow, CarouselDots, DisplayHeading, Eyebrow, PHONE_IMAGE, ResponsiveImage, cn, useCarousel } from "~/components/ui";
import { CtaLink } from "~/features/public/content";
import { localePath } from "~/lib/config";
import { useLocale, useT } from "~/lib/i18n";
import type { HomeSection } from "~/lib/types";

import { accentSplit, homeWidth } from "./sections";

function HeroSlide({ section, active, first }: { section: HomeSection; active: boolean; first: boolean }) {
  const t = useT();
  const locale = useLocale();
  const c = section.content;
  const [lead, accent] = accentSplit(c.title);
  return (
    <div
      aria-hidden={active ? undefined : true}
      inert={!active}
      className={cn("relative col-start-1 row-start-1 flex items-center pb-28 pt-14 transition-[opacity,visibility] duration-300 motion-reduce:transition-none lg:min-h-[39vw] lg:pb-32 lg:pt-16", active ? "opacity-100" : "invisible opacity-0")}
    >
      <ResponsiveImage image={section.image} sizes={`(min-width: 640px) 100vw, ${PHONE_IMAGE}`} priority={first} className="absolute inset-0 -z-10 size-full object-[72%_center] lg:object-center" />
      {/* Stops measured against all three photos: the weakest that keeps text over bright sky at AA. */}
      <div className="absolute inset-0 -z-10 bg-ink/80 lg:bg-transparent lg:bg-gradient-to-r lg:from-ink/90 lg:from-0% lg:via-ink/75 lg:via-45% lg:to-ink/0 lg:to-72%" aria-hidden="true" />
      <div className={homeWidth}>
        <div className="text-ink-fg lg:max-w-[46vw]">
          {c.subtitle && <Eyebrow tone="photo">{c.subtitle}</Eyebrow>}
          <DisplayHeading as={first ? "h1" : "h2"} className="mt-4 whitespace-pre-line text-[clamp(2.5rem,1rem+3.6vw,6rem)] leading-[1.02]!">
            {lead}
            <span className="text-accent">{accent}</span>
          </DisplayHeading>
          {c.body && <p className="mt-5 max-w-[36em] text-lg leading-relaxed text-ink-fg xl:text-xl">{c.body}</p>}
          {/* Two equal halves on every screen; labels stay short so they fit one line on a phone. */}
          <div className="mt-7 grid max-w-md grid-cols-2 gap-3">
            {c.cta_label && c.cta_url && <CtaLink label={c.cta_label} url={c.cta_url} variant="accent" pill full className={heroButton} />}
            <ButtonLink to={localePath(locale, "/departures")} variant="photo" size="lg" pill full className={heroButton}>
              {t("public.home.see_departures")}
            </ButtonLink>
          </div>
        </div>
      </div>
    </div>
  );
}


const heroButton = "whitespace-nowrap max-sm:!px-3 max-sm:!text-sm";

export function HeroCarousel({ slides }: { slides: HomeSection[] }) {
  const t = useT();
  const { index, go, next, prev } = useCarousel(slides.length);
  return (
    <section aria-roledescription="carousel" aria-label={t("public.home.hero_label")} className="on-ink relative isolate grid bg-ink">
      {slides.map((s, i) => (
        <HeroSlide key={s.id} section={s} active={i === index} first={i === 0} />
      ))}
      {slides.length > 1 && (
        <>
          <div className="absolute left-3 top-1/2 hidden -translate-y-1/2 xl:block">
            <CarouselArrow direction="prev" label={t("public.home.prev_slide")} onClick={prev} tone="photo" />
          </div>
          <div className="absolute right-3 top-1/2 hidden -translate-y-1/2 md:block">
            <CarouselArrow direction="next" label={t("public.home.next_slide")} onClick={next} tone="photo" />
          </div>
          <CarouselDots
            count={slides.length}
            index={index}
            onSelect={go}
            label={(n) => t("public.home.go_to_slide", { n })}
            tone="photo"
            className="absolute bottom-[4.5rem] left-1/2 -translate-x-1/2 lg:bottom-[4.75rem]"
          />
        </>
      )}
    </section>
  );
}
