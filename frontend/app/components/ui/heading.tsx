import type { ReactNode } from "react";

import { cn } from "./cn";

// Eyebrow is the gold label with a trailing rule that opens each homepage section. Bright gold only
// passes contrast on navy or photos; on the page it uses the darker accent-text token.
export function Eyebrow({ children, as: Tag = "p", tone = "page", centered, className }: { children: ReactNode; as?: "p" | "h2"; tone?: "page" | "photo"; centered?: boolean; className?: string }) {
  return (
    <Tag className={cn("flex items-center gap-3 text-[clamp(0.875rem,0.7rem+0.35vw,1.125rem)] font-semibold uppercase tracking-[0.08em]", tone === "photo" ? "text-accent" : "text-accent-text", centered && "justify-center", className)}>
      {centered && <span className="h-px w-8 bg-current opacity-60" aria-hidden="true" />}
      {children}
      <span className={cn("h-px bg-current opacity-60", centered ? "w-8" : "w-14")} aria-hidden="true" />
    </Tag>
  );
}

export function DisplayHeading({ children, as: Tag = "h2", className }: { children: ReactNode; as?: "h1" | "h2"; className?: string }) {
  return <Tag className={cn("font-display font-normal leading-[1.08] tracking-[-0.015em]", className)}>{children}</Tag>;
}
