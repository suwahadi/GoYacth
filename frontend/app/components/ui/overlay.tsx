import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { useT } from "~/lib/i18n";

import { Button, ButtonPair } from "./button";
import { cn } from "./cn";

function useDialog(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const handle = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    d.addEventListener("cancel", handle);
    return () => d.removeEventListener("cancel", handle);
  }, [onClose]);
  return ref;
}

// Dialog uses the native <dialog> element for focus trapping and Escape handling.
export function Dialog({ open, onClose, title, children, footer, size = "md" }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; size?: "sm" | "md" | "lg" }) {
  const ref = useDialog(open, onClose);
  const titleId = useId();
  const t = useT();
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={cn(
        "m-auto w-[calc(100%-2rem)] rounded-lg border border-border bg-surface p-0 text-fg shadow-xl backdrop:bg-overlay",
        size === "sm" ? "max-w-sm" : size === "lg" ? "max-w-3xl" : "max-w-lg",
      )}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
            <h2 id={titleId} className="text-lg font-semibold">
              {title}
            </h2>
            <button type="button" onClick={onClose} className="rounded p-1 text-muted hover:bg-surface-2" aria-label={t("common.actions.close")}>
              ✕
            </button>
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="border-t border-border px-5 py-4">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

export function Drawer({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  const ref = useDialog(open, onClose);
  const titleId = useId();
  const t = useT();
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className="m-0 ml-auto h-full max-h-full w-[min(24rem,100vw)] max-w-full border-l border-border bg-surface p-0 text-fg backdrop:bg-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {open && (
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <h2 id={titleId} className="text-lg font-semibold">
              {title}
            </h2>
            <button type="button" onClick={onClose} className="rounded p-1 text-muted hover:bg-surface-2" aria-label={t("common.actions.close")}>
              ✕
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="border-t border-border px-5 py-4">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  tone = "primary",
  pending,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  tone?: "primary" | "danger";
  pending?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const t = useT();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <ButtonPair>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            {t("common.actions.cancel")}
          </Button>
          <Button variant={tone} onClick={onConfirm} pending={pending}>
            {confirmLabel}
          </Button>
        </ButtonPair>
      }
    >
      <div className="text-sm">{body}</div>
    </Dialog>
  );
}

export function Dropdown({ label, children, align = "right", triggerClassName }: { label: ReactNode; children: ReactNode; align?: "left" | "right"; triggerClassName?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuId = useId();
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-haspopup="menu" aria-expanded={open} aria-controls={menuId} onClick={() => setOpen((o) => !o)} className={triggerClassName ?? "flex items-center gap-1 rounded-md px-2 py-1.5 text-sm hover:bg-surface-2"}>
        {label}
      </button>
      {open && (
        <div id={menuId} role="menu" className={cn("absolute z-40 mt-1 min-w-44 rounded-md border border-border bg-surface py-1 shadow-lg", align === "right" ? "right-0" : "left-0")} onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  );
}

export function DropdownItem({ children, onClick, href }: { children: ReactNode; onClick?: () => void; href?: string }) {
  const cls = "block w-full px-3 py-2 text-left text-sm hover:bg-surface-2";
  if (href) {
    return (
      <a role="menuitem" href={href} className={cls}>
        {children}
      </a>
    );
  }
  return (
    <button type="button" role="menuitem" className={cls} onClick={onClick}>
      {children}
    </button>
  );
}
