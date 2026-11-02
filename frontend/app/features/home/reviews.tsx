import { CarouselArrow, CarouselDots, Eyebrow, cn, useCarousel } from "~/components/ui";
import { Stars, initials } from "~/features/public/components";
import { countryName } from "~/lib/format";
import { useLocale, useT } from "~/lib/i18n";
import type { HomeSection, Review } from "~/lib/types";

import { asArray, homeWidth } from "./sections";

export function ReviewsSection({ section }: { section: HomeSection }) {
  const t = useT();
  const locale = useLocale();
  const reviews = asArray<Review>(section.data);
  const { index, go, next, prev } = useCarousel(reviews.length);
  const review = reviews[index];
  if (!review) return null;
  const many = reviews.length > 1;
  return (
    <section id="reviews" className={cn(homeWidth, "scroll-mt-20 pb-12 pt-4 lg:pb-14")}>
      <Eyebrow as="h2" centered>
        {section.content.title || t("public.home.reviews_title")}
      </Eyebrow>
      <div className="mt-4 flex items-center justify-center gap-4 lg:gap-24">
        {many && (
          <div className="hidden sm:block">
            <CarouselArrow direction="prev" label={t("public.home.prev_review")} onClick={prev} />
          </div>
        )}
        <figure aria-live="polite" lang={review.locale} className="flex w-full max-w-[46rem] items-center gap-5 rounded-2xl border border-border bg-surface px-5 py-4 lg:gap-6 lg:px-8">
          <span className="hidden size-16 shrink-0 place-items-center rounded-full border border-accent font-display text-2xl text-accent-text sm:grid" aria-hidden="true">
            {initials(review.author_name)}
          </span>
          <div className="min-w-0">
            <p className="leading-none">
              <Stars rating={review.rating_overall} className="text-xl" />
            </p>
            <blockquote className="mt-2 font-display text-lg italic leading-snug xl:text-xl before:content-['\201C'] after:content-['\201D']">{review.body}</blockquote>
            <figcaption className="mt-1 text-sm text-muted">
              {review.author_country ? t("public.reviews.from", { name: review.author_name, country: countryName(review.author_country, locale) }) : review.author_name}
            </figcaption>
          </div>
        </figure>
        {many && (
          <div className="hidden sm:block">
            <CarouselArrow direction="next" label={t("public.home.next_review")} onClick={next} />
          </div>
        )}
      </div>
      {many && (
        <div className="flex items-center justify-center">
          <CarouselDots count={reviews.length} index={index} onSelect={go} label={(n) => t("public.home.go_to_review", { n })} />
        </div>
      )}
    </section>
  );
}
