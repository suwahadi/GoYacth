import { useState } from "react";

import { cn } from "./cn";
import { ChevronLeftIcon, ChevronRightIcon } from "./icons";

type Tone = "photo" | "page";

export function useCarousel(count: number, initial = 0) {
  const [position, go] = useState(initial);
  const index = count > 0 ? ((position % count) + count) % count : 0;
  return { index, go, next: () => go(index + 1), prev: () => go(index - 1) };
}

export function CarouselArrow({ direction, label, onClick, tone = "page", className }: { direction: "prev" | "next"; label: string; onClick: () => void; tone?: Tone; className?: string }) {
  const Icon = direction === "prev" ? ChevronLeftIcon : ChevronRightIcon;
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        "grid size-11 shrink-0 cursor-pointer place-items-center rounded-full border transition-colors",
        tone === "photo" ? "border-ink-fg/70 bg-ink/30 text-ink-fg hover:bg-ink/70" : "border-primary bg-surface text-primary hover:bg-surface-2",
        className,
      )}
    >
      <Icon className="size-5" />
    </button>
  );
}

export function CarouselDots({ count, index, onSelect, label, tone = "page", className }: { count: number; index: number; onSelect: (i: number) => void; label: (n: number) => string; tone?: Tone; className?: string }) {
  return (
    <div className={cn("flex items-center", className)}>
      {Array.from({ length: count }, (_, i) => (
        <button key={i} type="button" aria-label={label(i + 1)} aria-current={i === index ? "true" : undefined} onClick={() => onSelect(i)} className="flex h-11 cursor-pointer items-center px-3 lg:px-1">
          <span className={cn("block h-1.5 rounded-full transition-all duration-200 motion-reduce:transition-none", i === index ? "w-7 bg-accent" : cn("w-5", tone === "photo" ? "bg-ink-fg/70" : "bg-muted/50"))} />
        </button>
      ))}
    </div>
  );
}
