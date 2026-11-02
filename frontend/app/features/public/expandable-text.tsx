import { useEffect, useId, useRef, useState } from "react";

import { ChevronDownIcon, cn } from "~/components/ui";
import { useT } from "~/lib/i18n";

// Text longer than this is collapsed on first render. Deciding by length keeps the server and
// client output identical, so the page does not jump when it hydrates.
const LONG_TEXT = 420;
const COLLAPSED = "11rem";

// ExpandableText shows the start of a long text and grows to its full height in place.
export function ExpandableText({ text, className }: { text: string; className?: string }) {
  const t = useT();
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const toggled = useRef(false);
  const [open, setOpen] = useState(false);
  const [height, setHeight] = useState<string>(COLLAPSED);
  const long = text.length > LONG_TEXT;

  // max-height only animates between lengths, so the open state animates to the measured height
  // and then drops the limit (onTransitionEnd) to follow later reflows such as a rotated phone.
  // Closing starts again from the measured height for the same reason.
  useEffect(() => {
    const el = ref.current;
    if (!el || !long) return;
    if (!toggled.current) return;
    if (open) {
      // Without animation no transitionend fires, so the limit is dropped right away.
      setHeight(window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "none" : `${el.scrollHeight}px`);
      return;
    }
    setHeight(`${el.scrollHeight}px`);
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => setHeight(COLLAPSED)));
    return () => cancelAnimationFrame(frame);
  }, [open, long, text]);

  if (!long) return <p className={cn("whitespace-pre-line", className)}>{text}</p>;
  return (
    <div>
      <div
        id={id}
        ref={ref}
        style={{ maxHeight: height }}
        onTransitionEnd={() => open && setHeight("none")}
        className={cn(
          "relative overflow-hidden transition-[max-height] duration-500 ease-in-out motion-reduce:transition-none",
          !open && "after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-16 after:bg-gradient-to-t after:from-bg after:to-transparent",
        )}
      >
        <p className={cn("whitespace-pre-line", className)}>{text}</p>
      </div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          toggled.current = true;
          setOpen(!open);
        }}
        className="mt-2 inline-flex cursor-pointer items-center gap-1 py-2 text-sm font-medium text-primary underline-offset-4 hover:underline"
      >
        {t(open ? "public.boat.view_less" : "public.boat.view_more")}
        <ChevronDownIcon className={cn("size-4 transition-transform duration-300", open && "rotate-180")} />
      </button>
    </div>
  );
}
