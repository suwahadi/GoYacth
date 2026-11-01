import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import { useT } from "~/lib/i18n";

import { cn } from "./cn";

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn("animate-spin", className ?? "size-5")} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
      <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-surface-2", className)} aria-hidden="true" />;
}

export function SkeletonList({ rows = 4 }: { rows?: number }) {
  const t = useT();
  return (
    <div role="status" aria-label={t("common.states.loading")} className="space-y-3">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-16 w-full" />
      ))}
    </div>
  );
}

export function EmptyState({ title, body, action }: { title?: string; body?: string; action?: ReactNode }) {
  const t = useT();
  return (
    <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-10 text-center">
      <p className="font-medium">{title ?? t("common.states.empty")}</p>
      {body && <p className="mt-1 text-sm text-muted">{body}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  const t = useT();
  return (
    <div role="alert" className="rounded-lg border border-danger/40 bg-danger-bg px-6 py-8 text-center">
      <p className="font-medium text-danger">{t("common.states.error_title")}</p>
      <p className="mt-1 text-sm">{message ?? t("validation.errors.UNKNOWN")}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="mt-4 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium hover:bg-surface-2">
          {t("common.actions.retry")}
        </button>
      )}
    </div>
  );
}

type AlertTone = "info" | "success" | "warning" | "danger";

const tones: Record<AlertTone, string> = {
  info: "bg-info-bg border-border",
  success: "bg-success-bg border-success/40 text-success",
  warning: "bg-warning-bg border-warning/40",
  danger: "bg-danger-bg border-danger/40 text-danger",
};

export function Alert({ tone = "info", title, children, className }: { tone?: AlertTone; title?: string; children?: ReactNode; className?: string }) {
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("rounded-md border px-4 py-3 text-sm", tones[tone], className)}>
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={cn(title && "mt-1", "text-fg")}>{children}</div>}
    </div>
  );
}

interface Toast {
  id: number;
  message: string;
  tone: "success" | "danger" | "info";
}

const ToastContext = createContext<(message: string, tone?: Toast["tone"]) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((message: string, tone: Toast["tone"] = "success") => {
    const id = Date.now() + Math.random();
    setToasts((ts) => [...ts, { id, message, tone }]);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDone={() => setToasts((ts) => ts.filter((x) => x.id !== t.id))} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDone }: { toast: Toast; onDone: () => void }) {
  useEffect(() => {
    const h = setTimeout(onDone, 4000);
    return () => clearTimeout(h);
  }, [onDone]);
  return (
    <div
      role="status"
      className={cn(
        "pointer-events-auto w-full max-w-sm rounded-md border px-4 py-3 text-sm shadow-lg",
        toast.tone === "danger" ? "border-danger/40 bg-danger-bg text-danger" : toast.tone === "info" ? "border-border bg-surface" : "border-success/40 bg-success-bg text-success",
      )}
    >
      {toast.message}
    </div>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
