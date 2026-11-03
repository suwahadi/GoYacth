import { useRef, useState } from "react";

import { CarouselArrow, CarouselDots, Eyebrow, cn, useCarousel } from "~/components/ui";
import { Stars, initials } from "~/features/public/components";
import { countryName } from "~/lib/format";
import { useLocale, useT } from "~/lib/i18n";
import type { HomeSection, Review } from "~/lib/types";

import { asArray, homeWidth } from "./sections";

const PER_DESKTOP_PAGE = 3;

function pagesOf(reviews: Review[], size: number): Review[][] {
  const pages: Review[][] = [];
  for (let i = 0; i < reviews.length; i += size) pages.push(reviews.slice(i, i + size));
  return pages;
}

// Phones swipe through one review at a time; desktops page through three side by side. Both are
// rendered and CSS shows the right one, so the server and the browser agree on the markup.
export function ReviewsSection({ section }: { section: HomeSection }) {
  const t = useT();
  const reviews = asArray<Review>(section.data);
  if (reviews.length === 0) return null;
  return (
    <section id="reviews" className={cn(homeWidth, "scroll-mt-20 pb-12 pt-4 lg:pb-14")}>
      <Eyebrow as="h2" centered>
        {section.content.title || t("public.home.reviews_title")}
      </Eyebrow>
      <div className="lg:hidden">
        <SwipeReviews reviews={reviews} />
      </div>
      <div className="hidden lg:block">
        <ReviewCarousel pages={pagesOf(reviews, PER_DESKTOP_PAGE)} />
      </div>
    </section>
  );
}

function ReviewCarousel({ pages }: { pages: Review[][] }) {
  const t = useT();
  const { index, go, next, prev } = useCarousel(pages.length);
  const many = pages.length > 1;
  return (
    <>
      <div className="mt-5 flex items-center justify-center gap-4 lg:gap-6">
        {many && (
          <div className="hidden sm:block">
            <CarouselArrow direction="prev" label={t("public.home.prev_review")} onClick={prev} />
          </div>
        )}
        <ul aria-live="polite" className="grid w-full max-w-[46rem] gap-5 lg:max-w-none lg:grid-cols-3">
          {pages[index].map((r) => (
            <ReviewCard key={r.id} review={r} />
          ))}
        </ul>
        {many && (
          <div className="hidden sm:block">
            <CarouselArrow direction="next" label={t("public.home.next_review")} onClick={next} />
          </div>
        )}
      </div>
      {many && (
        <div className="flex items-center justify-center">
          <CarouselDots count={pages.length} index={index} onSelect={go} label={(n) => t("public.home.go_to_review", { n })} />
        </div>
      )}
    </>
  );
}

// slideStep is the distance between neighbouring slides, gap included, so the index follows the scroll position.
function slideStep(track: HTMLElement): number {
  const [a, b] = Array.from(track.children) as HTMLElement[];
  return a && b ? b.offsetLeft - a.offsetLeft : track.clientWidth;
}

// The track scrolls natively, so a card follows the finger and snaps one review at a time. Arrows
// and dots stay as visible controls for people who do not swipe.
function SwipeReviews({ reviews }: { reviews: Review[] }) {
  const t = useT();
  const track = useRef<HTMLUListElement>(null);
  const [index, setIndex] = useState(0);
  const many = reviews.length > 1;
  const go = (i: number) => {
    const el = track.current;
    if (!el) return;
    const n = (i + reviews.length) % reviews.length;
    const smooth = !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo?.({ left: n * slideStep(el), behavior: smooth ? "smooth" : "auto" });
    setIndex(n);
  };
  return (
    <>
      <div className="mt-5 flex items-center justify-center gap-4">
        {many && (
          <div className="hidden sm:block">
            <CarouselArrow direction="prev" label={t("public.home.prev_review")} onClick={() => go(index - 1)} />
          </div>
        )}
        <ul
          ref={track}
          onScroll={(e) => setIndex(Math.round(e.currentTarget.scrollLeft / slideStep(e.currentTarget)))}
          className="relative flex w-full max-w-[46rem] snap-x snap-mandatory gap-4 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {reviews.map((r) => (
            <ReviewCard key={r.id} review={r} className="w-full shrink-0 snap-center" />
          ))}
        </ul>
        {many && (
          <div className="hidden sm:block">
            <CarouselArrow direction="next" label={t("public.home.next_review")} onClick={() => go(index + 1)} />
          </div>
        )}
      </div>
      {many && (
        <div className="flex items-center justify-center">
          <CarouselDots count={reviews.length} index={index} onSelect={go} label={(n) => t("public.home.go_to_review", { n })} />
        </div>
      )}
    </>
  );
}

function ReviewCard({ review, className }: { review: Review; className?: string }) {
  const locale = useLocale();
  return (
    <li className={cn("flex", className)}>
      <figure lang={review.locale} className="flex w-full flex-col rounded-2xl border border-border bg-surface p-5 lg:p-6">
        <p className="leading-none">
          <Stars rating={review.rating_overall} className="text-lg" />
        </p>
        <blockquote className="mt-3 flex-1 font-display text-lg italic leading-snug before:content-['\201C'] after:content-['\201D']">{review.body}</blockquote>
        <figcaption className="mt-4 flex items-center gap-3 text-sm">
          <span className="grid size-10 shrink-0 place-items-center rounded-full border border-accent font-display text-base text-accent-text" aria-hidden="true">
            {initials(review.author_name)}
          </span>
          <span className="min-w-0">
            <span className="block truncate font-medium">{review.author_name}</span>
            {review.author_country && <span className="block truncate text-muted">{countryName(review.author_country, locale)}</span>}
          </span>
        </figcaption>
      </figure>
    </li>
  );
}
