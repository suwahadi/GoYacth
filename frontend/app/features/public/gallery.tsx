import { useEffect, useId, useRef, useState } from "react";

import { CarouselArrow, CarouselDots, CloseIcon, PHONE_IMAGE, ResponsiveImage, cn, useCarousel } from "~/components/ui";
import { useT } from "~/lib/i18n";
import type { Img } from "~/lib/types";

const THUMBS = 8;
const MAX_DOTS = 12;

// Gallery shows the cover photo and up to eight thumbnails; any of them opens the lightbox on
// that photo. The last thumbnail counts the photos that did not fit.
export function Gallery({ images, fallback }: { images: Img[]; fallback?: Img | null }) {
  const t = useT();
  const [open, setOpen] = useState<number | null>(null);
  const list = images.length > 0 ? images : fallback ? [fallback] : [];
  if (list.length === 0) return null;
  const [first, ...rest] = list;
  const shown = rest.slice(0, THUMBS);
  const hidden = rest.length - shown.length;
  const label = (n: number) => t("public.gallery.open", { n, total: list.length });
  return (
    <section aria-label={t("public.boat.gallery")} className="space-y-2">
      <button type="button" className="block w-full cursor-pointer overflow-hidden rounded-lg" onClick={() => setOpen(0)} aria-label={label(1)}>
        <ResponsiveImage
          image={first}
          sizes={`(min-width: 1152px) 1120px, (min-width: 640px) 100vw, ${PHONE_IMAGE}`}
          priority
          className="aspect-[16/9] h-auto w-full transition-transform duration-300 hover:scale-[1.02] motion-reduce:transition-none"
        />
      </button>
      {shown.length > 0 && (
        <ul className="grid grid-cols-4 gap-2">
          {shown.map((img, i) => {
            const more = hidden > 0 && i === shown.length - 1;
            return (
              <li key={img.id}>
                <button type="button" className="relative block w-full cursor-pointer overflow-hidden rounded" onClick={() => setOpen(i + 1)} aria-label={label(i + 2)}>
                  <ResponsiveImage
                    image={img}
                    sizes="(min-width: 640px) 25vw, 25vw"
                    className="aspect-[4/3] h-auto w-full transition-transform duration-300 hover:scale-105 motion-reduce:transition-none"
                  />
                  {more && (
                    <span className="absolute inset-0 grid place-items-center bg-ink/55 font-medium text-ink-fg" aria-hidden="true">
                      +{hidden + 1}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {open !== null && <Lightbox images={list} start={open} onClose={() => setOpen(null)} />}
    </section>
  );
}

// Lightbox is a full-screen dialog with arrows, dot indicators, arrow keys and swipe. It never
// advances on its own.
function Lightbox({ images, start, onClose }: { images: Img[]; start: number; onClose: () => void }) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const { index, go, next, prev } = useCarousel(images.length, start);
  const touch = useRef<number | null>(null);
  const many = images.length > 1;

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") next();
      if (e.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev]);

  const image = images[index];
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className="m-0 h-dvh max-h-none w-screen max-w-none bg-ink/95 p-0 text-ink-fg backdrop:bg-ink/80"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between gap-4 px-4 py-3">
          <p id={titleId} className="text-sm" aria-live="polite">
            {t("public.gallery.counter", {
              n: index + 1,
              total: images.length,
            })}
          </p>
          <button type="button" onClick={onClose} className="grid size-11 cursor-pointer place-items-center rounded-full hover:bg-ink-fg/10" aria-label={t("common.actions.close")}>
            <CloseIcon className="size-6" />
          </button>
        </div>
        <div
          className="relative flex min-h-0 flex-1 items-center justify-center px-2 sm:px-16"
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
          onTouchStart={(e) => (touch.current = e.touches[0].clientX)}
          onTouchEnd={(e) => {
            if (touch.current === null) return;
            const dx = e.changedTouches[0].clientX - touch.current;
            touch.current = null;
            if (Math.abs(dx) > 40) (dx < 0 ? next : prev)();
          }}
        >
          <ResponsiveImage key={image.id} image={image} sizes="100vw" className="max-h-full w-auto max-w-full animate-fade-in rounded object-contain motion-reduce:animate-none" />
          {many && (
            <>
              <CarouselArrow direction="prev" tone="photo" label={t("public.gallery.prev")} onClick={prev} className="absolute left-2 top-1/2 hidden -translate-y-1/2 sm:grid sm:left-4" />
              <CarouselArrow direction="next" tone="photo" label={t("public.gallery.next")} onClick={next} className="absolute right-2 top-1/2 hidden -translate-y-1/2 sm:grid sm:right-4" />
            </>
          )}
        </div>
        <div className={cn("flex min-h-16 items-center justify-center gap-2 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2", !many && "invisible")}>
          <CarouselArrow direction="prev" tone="photo" label={t("public.gallery.prev")} onClick={prev} className="sm:hidden" />
          {images.length <= MAX_DOTS ? (
            <CarouselDots count={images.length} index={index} onSelect={go} tone="photo" label={(n) => t("public.gallery.go_to", { n })} />
          ) : (
            <span className="px-3 text-sm">
              {t("public.gallery.counter", {
                n: index + 1,
                total: images.length,
              })}
            </span>
          )}
          <CarouselArrow direction="next" tone="photo" label={t("public.gallery.next")} onClick={next} className="sm:hidden" />
        </div>
      </div>
    </dialog>
  );
}
