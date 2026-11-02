import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Link, type LinkProps } from "react-router";

import { cn } from "./cn";
import { Spinner } from "./feedback";

type Variant = "primary" | "accent" | "photo" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  primary: "bg-primary text-primary-fg hover:bg-primary-hover border border-transparent",
  accent: "bg-accent text-accent-fg hover:bg-accent-hover border border-transparent",
  photo: "bg-ink/25 text-ink-fg border border-ink-fg/70 hover:bg-ink/60",
  secondary: "bg-surface text-fg border border-border hover:bg-surface-2",
  ghost: "bg-transparent text-fg border border-transparent hover:bg-surface-2",
  danger: "bg-danger text-primary-fg border border-transparent hover:opacity-90",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-5 text-base",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", full = false, pill = false) {
  return cn(
    "inline-flex items-center justify-center gap-2 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 whitespace-nowrap",
    pill ? "rounded-full" : "rounded-md",
    variants[variant],
    sizes[size],
    full && "w-full",
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  full?: boolean;
  pill?: boolean;
  pending?: boolean;
  icon?: ReactNode;
}

// Button shows a spinner and disables itself while pending, so a double click cannot submit
// twice from the UI. The server's idempotency keys remain the real guard.
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", full, pill, pending, icon, className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button ref={ref} type={type} className={cn(buttonClass(variant, size, full, pill), className)} disabled={disabled || pending} aria-busy={pending || undefined} {...rest}>
      {pending ? <Spinner className="size-4" /> : icon}
      {children}
    </button>
  );
});

export function ButtonLink({ variant = "primary", size = "md", full, pill, className, ...rest }: LinkProps & { variant?: Variant; size?: Size; full?: boolean; pill?: boolean }) {
  return <Link className={cn(buttonClass(variant, size, full, pill), className)} {...rest} />;
}

// ButtonPair renders exactly two sibling actions at equal width (AGENTS.md section 13).
export function ButtonPair({ children, className }: { children: [ReactNode, ReactNode]; className?: string }) {
  return <div className={cn("grid grid-cols-2 gap-3", className)}>{children}</div>;
}
