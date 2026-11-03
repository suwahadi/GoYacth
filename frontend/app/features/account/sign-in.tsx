import { type FormEvent, type ReactNode, useRef, useState } from "react";

import { Alert, ApiErrorMessage, Button, Dialog, Field, Input, buttonClass, useFieldErrors } from "~/components/ui";
import { Turnstile, type TurnstileHandle } from "~/features/booking/Turnstile";
import { api } from "~/lib/api";
import { useLocale, useT } from "~/lib/i18n";
import { useRootData } from "~/root";

export type SignInMode = "login" | "register" | "forgot";

const SELF = "http://self.invalid";

// Only same-site paths are followed after signing in. The value is parsed the way a browser reads
// it, and the parsed result is checked again: "/\t/x.com" loses its tab and "/a/..//x.com" collapses
// dot segments, and both would otherwise end up as "//x.com".
export function safeReturnPath(raw: string | null | undefined, fallback = "/"): string {
  if (!raw?.startsWith("/")) return fallback;
  try {
    const u = new URL(raw, SELF);
    const out = u.pathname + u.search + u.hash;
    return u.origin === SELF && !out.startsWith("//") && !out.startsWith("/\\") ? out : fallback;
  } catch {
    return fallback;
  }
}

export function useSignInTitle(mode: SignInMode): string {
  const t = useT();
  return t(mode === "login" ? "common.auth.login_title" : mode === "register" ? "common.auth.register_title" : "common.auth.forgot_title");
}

// SignInForm serves the header popup and the /login page. Email and password come first; Google
// stays one tap away below them. Sign-up asks for no password: the emailed link leads to choosing
// one, so only the owner of the inbox ever sets it.
export function SignInForm({ mode, onMode, returnTo }: { mode: SignInMode; onMode: (m: SignInMode) => void; returnTo: string }) {
  const t = useT();
  const locale = useLocale();
  const siteKey = useRootData().turnstileSiteKey;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [captcha, setCaptcha] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<ReactNode>(null);
  const turnstile = useRef<TurnstileHandle>(null);
  const fe = useFieldErrors(error);
  const needsCaptcha = mode !== "login" && !!siteKey;

  const switchTo = (m: SignInMode) => {
    setError(null);
    setNotice(null);
    onMode(m);
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const address = email.trim();
    try {
      if (mode === "login") {
        await api("/auth/login", { method: "POST", body: { email: address, password } });
        // A full load lets the server render the page with the new session cookie.
        window.location.href = returnTo;
        return;
      }
      if (mode === "register") {
        await api("/auth/register", { method: "POST", body: { email: address, full_name: fullName.trim(), locale, return_to: returnTo, turnstile_token: captcha } });
        setNotice(t("common.auth.register_sent", { email: address }));
      } else {
        await api("/auth/password/forgot", { method: "POST", body: { email: address, turnstile_token: captcha } });
        setNotice(t("common.auth.forgot_sent", { email: address }));
      }
      setPassword("");
    } catch (err) {
      setError(err);
      if (mode === "login") setPassword("");
    } finally {
      setPending(false);
      turnstile.current?.reset();
    }
  }

  if (notice) {
    return (
      <div className="space-y-4" aria-live="polite">
        <Alert tone="success">{notice}</Alert>
        <Button variant="secondary" full onClick={() => switchTo("login")}>
          {t("common.auth.back_to_login")}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <form onSubmit={submit} className="space-y-4">
        {mode === "register" && (
          <Field label={t("common.auth.full_name")} required error={fe["full_name"]}>
            {(p) => <Input {...p} value={fullName} onChange={(e) => setFullName(e.target.value)} required autoComplete="name" maxLength={120} />}
          </Field>
        )}
        <Field label={t("common.auth.email")} required error={fe["email"]}>
          {(p) => <Input {...p} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete={mode === "register" ? "email" : "username"} maxLength={254} />}
        </Field>
        {mode === "login" && (
          <Field label={t("common.auth.password")} required error={fe["password"]}>
            {(p) => <Input {...p} type="password" value={password} onChange={(e) => setPassword(e.target.value)} required maxLength={72} autoComplete="current-password" />}
          </Field>
        )}
        {mode === "login" && (
          <button type="button" className="-my-3 inline-block py-3 text-sm text-primary hover:underline" onClick={() => switchTo("forgot")}>
            {t("common.auth.forgot_link")}
          </button>
        )}
        {needsCaptcha && <Turnstile ref={turnstile} siteKey={siteKey} onToken={setCaptcha} />}
        <ApiErrorMessage error={error} />
        <Button type="submit" size="lg" full pending={pending} disabled={needsCaptcha && !captcha}>
          {t(mode === "login" ? "common.auth.submit_login" : mode === "register" ? "common.auth.submit_register" : "common.auth.submit_forgot")}
        </Button>
      </form>

      {mode !== "forgot" && (
        <>
          <div className="flex items-center gap-3 text-sm text-muted" role="separator">
            <span className="h-px flex-1 bg-border" />
            {t("common.auth.or")}
            <span className="h-px flex-1 bg-border" />
          </div>
          <a href={`/api/v1/auth/google?return_to=${encodeURIComponent(returnTo)}`} className={buttonClass("secondary", "lg", true)}>
            <GoogleMark className="size-5" />
            {t("common.auth.sign_in_google")}
          </a>
        </>
      )}

      <p className="text-center text-sm text-muted">
        {mode === "login" ? (
          <>
            {t("common.auth.no_account")}{" "}
            <button type="button" className="-my-3 inline-block py-3 font-medium text-primary hover:underline" onClick={() => switchTo("register")}>
              {t("common.auth.to_register")}
            </button>
          </>
        ) : (
          <>
            {t("common.auth.has_account")}{" "}
            <button type="button" className="-my-3 inline-block py-3 font-medium text-primary hover:underline" onClick={() => switchTo("login")}>
              {t("common.auth.to_login")}
            </button>
          </>
        )}
      </p>
    </div>
  );
}

export function SignInDialog({ open, onClose, returnTo }: { open: boolean; onClose: () => void; returnTo: string }) {
  const [mode, setMode] = useState<SignInMode>("login");
  const title = useSignInTitle(mode);
  return (
    <Dialog
      open={open}
      onClose={() => {
        onClose();
        setMode("login");
      }}
      title={title}
      size="sm"
      fullOnPhone
    >
      <SignInForm mode={mode} onMode={setMode} returnTo={returnTo} />
    </Dialog>
  );
}

// Google's own four-colour mark; its brand rules ask for it unaltered.
function GoogleMark(p: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...p}>
      <path fill="#4285F4" d="M23.52 12.27c0-.85-.08-1.66-.22-2.45H12v4.63h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.58-5.17 3.58-8.8Z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.9l-3.88-3.01c-1.07.72-2.45 1.15-4.06 1.15-3.12 0-5.77-2.11-6.71-4.95H1.28v3.11A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.29 14.29a7.2 7.2 0 0 1 0-4.58V6.6H1.28a12 12 0 0 0 0 10.8l4.01-3.11Z" />
      <path fill="#EA4335" d="M12 4.75c1.76 0 3.34.61 4.59 1.8l3.44-3.44A11.5 11.5 0 0 0 12 0 12 12 0 0 0 1.28 6.6l4.01 3.11C6.23 6.86 8.88 4.75 12 4.75Z" />
    </svg>
  );
}
