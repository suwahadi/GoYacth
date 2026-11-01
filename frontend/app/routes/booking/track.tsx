import { useRef, useState, type FormEvent } from "react";
import { data } from "react-router";

import type { Route } from "./+types/track";
import { ApiErrorMessage, Button, Card, Container, Field, Input, useFieldErrors } from "~/components/ui";
import { privateHeaders } from "~/features/account/session";
import { privateMeta } from "~/features/booking/meta";
import { TrackingCard } from "~/features/booking/TrackingCard";
import { Turnstile, type TurnstileHandle } from "~/features/booking/Turnstile";
import { apiData } from "~/lib/api";
import { useLocale, useT } from "~/lib/i18n";
import type { Tracking } from "~/lib/types";

export function loader() {
  return data({ siteKey: process.env.TURNSTILE_SITE_KEY ?? "" }, { headers: privateHeaders });
}

export function headers() {
  return privateHeaders;
}

export function meta({ location }: Route.MetaArgs) {
  return privateMeta(location, "booking.track.title");
}

export default function Track({ loaderData }: Route.ComponentProps) {
  const t = useT();
  const locale = useLocale();
  const { siteKey } = loaderData;
  const [bookingNumber, setBookingNumber] = useState("");
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<Tracking | null>(null);
  const turnstile = useRef<TurnstileHandle>(null);
  const ctrl = useRef<AbortController | null>(null);
  const fe = useFieldErrors(error);

  async function submit(e: FormEvent) {
    e.preventDefault();
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setPending(true);
    setError(null);
    setResult(null);
    try {
      const body = { booking_number: bookingNumber.trim(), email: email.trim(), turnstile_token: token, locale };
      setResult(await apiData<Tracking>("/orders/track", { method: "POST", body, signal: c.signal }));
    } catch (err) {
      if (!c.signal.aborted) setError(err);
    } finally {
      if (!c.signal.aborted) {
        setPending(false);
        turnstile.current?.reset();
      }
    }
  }

  return (
    <Container className="max-w-xl py-8">
      <h1 className="text-2xl font-bold">{t("booking.track.title")}</h1>
      <p className="mt-2 text-sm text-muted">{t("booking.track.intro")}</p>
      <Card className="mt-4">
        <form onSubmit={submit} className="space-y-4">
          <Field label={t("booking.track.number_label")} required error={fe["booking_number"]} hint={t("booking.track.number_hint")}>
            {(p) => <Input {...p} value={bookingNumber} onChange={(e) => setBookingNumber(e.target.value)} required autoCapitalize="characters" autoComplete="off" maxLength={40} />}
          </Field>
          <Field label={t("booking.track.email_label")} required error={fe["email"]}>
            {(p) => <Input {...p} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" maxLength={254} />}
          </Field>
          {siteKey && <Turnstile ref={turnstile} siteKey={siteKey} onToken={setToken} />}
          <ApiErrorMessage error={error} />
          <Button type="submit" full pending={pending} disabled={!bookingNumber.trim() || !email.trim() || (!!siteKey && !token)}>
            {t("booking.track.submit")}
          </Button>
        </form>
      </Card>
      {result && (
        <section className="mt-6" aria-live="polite">
          <TrackingCard tracking={result} />
        </section>
      )}
    </Container>
  );
}
