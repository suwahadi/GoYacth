import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, data, useNavigate, useRevalidator } from "react-router";

import type { Route } from "./+types/checkout";
import {
  Alert,
  ApiErrorMessage,
  Button,
  ButtonLink,
  Card,
  Checkbox,
  Container,
  ErrorState,
  Field,
  Input,
  Money,
  PhoneInput,
  SearchableSelect,
  Select,
  Textarea,
  useApiErrorText,
  useCountryOptions,
  useFieldErrors,
} from "~/components/ui";
import { isUnauthenticated, loginRedirect, privateHeaders, requireUser } from "~/features/account/session";
import type { Profile } from "~/features/account/types";
import { coerceIdType, idTypeOptions } from "~/features/booking/identity";
import { nextIdempotencyKey, type KeyedContent } from "~/features/booking/idempotency";
import { privateMeta } from "~/features/booking/meta";
import { PaymentMethodPicker } from "~/features/booking/PaymentMethodPicker";
import { parseCheckoutParams } from "~/features/booking/product";
import { QuoteSummary } from "~/features/booking/QuoteSummary";
import { deserializeError, serializeError } from "~/features/booking/routeErrors";
import { createPayment, openPayment } from "~/features/booking/snap";
import type { QuoteRequest } from "~/features/booking/types";
import { useLiveQuote } from "~/features/booking/useLiveQuote";
import { ApiError, apiData, newIdempotencyKey } from "~/lib/api";
import { localePath, splitLocale } from "~/lib/config";
import { COUNTRY_CODES } from "~/lib/countries";
import { useLocale, useT, useTCode } from "~/lib/i18n";
import type { BoatDetail, Booking, PaymentMethodOption, Quote } from "~/lib/types";
import { PageHero } from "~/features/public/components";

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const { locale } = splitLocale(url.pathname);
  const me = await requireUser(request);
  const selection = parseCheckoutParams(url.searchParams);
  if (!selection) {
    return data({ me, selection, profile: null, methods: null, boat: null, quote: null, quoteError: null }, { headers: privateHeaders });
  }
  const [profile, methods, boat, priced] = await Promise.all([
    apiData<Profile>("/account/profile", { request }).catch((e: unknown) => {
      if (isUnauthenticated(e)) throw loginRedirect(request);
      return null;
    }),
    apiData<PaymentMethodOption[]>("/payment-methods").catch(() => null),
    selection.boatSlug
      ? apiData<BoatDetail>(`/boats/${encodeURIComponent(selection.boatSlug)}`, { query: { locale } }).catch(() => null)
      : Promise.resolve(null),
    // The quote is public and is requested without the session cookie: forwarding it would make
    // the API demand a CSRF token that the SSR server does not have.
    apiData<Quote>("/quotes", { method: "POST", body: { product: selection.product, pax: selection.pax, locale } }).then(
      (q) => ({ quote: q, error: null }),
      (e: unknown) => ({ quote: null, error: serializeError(e) }),
    ),
  ]);
  return data({ me, selection, profile, methods, boat, quote: priced.quote, quoteError: priced.error }, { headers: privateHeaders });
}

export function headers() {
  return privateHeaders;
}

export function meta({ location }: Route.MetaArgs) {
  return privateMeta(location, "booking.checkout.title");
}

export default function Checkout({ loaderData }: Route.ComponentProps) {
  const t = useT();
  const locale = useLocale();
  const errorText = useApiErrorText();
  const { selection, quote, quoteError, methods, boat } = loaderData;
  const backHref = localePath(locale, selection?.boatSlug ? `/boats/${selection.boatSlug}` : "/boats");

  if (!selection) {
    return (
      <>
        <PageHero title={t("booking.checkout.title")} crumbs={[{ name: t("public.breadcrumb.home"), path: "/" }, { name: t("booking.checkout.title") }]} width="max-w-2xl" />
        <Container className="max-w-2xl pb-8 pt-6">
          <Alert tone="warning" className="mt-4" title={t("booking.checkout.invalid_title")}>
            {t("booking.checkout.invalid_body")}
          </Alert>
          <ButtonLink to={backHref} variant="secondary" className="mt-4">
            {t("booking.checkout.back_to_trip")}
          </ButtonLink>
        </Container>
      </>
    );
  }
  if (!quote) {
    return (
      <>
        <PageHero title={t("booking.checkout.title")} crumbs={[{ name: t("public.breadcrumb.home"), path: "/" }, { name: t("booking.checkout.title") }]} width="max-w-2xl" />
        <Container className="max-w-2xl pb-8 pt-6">
          <Alert tone="danger" className="mt-4" title={t("booking.checkout.unavailable_title")}>
            {errorText(deserializeError(quoteError))}
          </Alert>
          <ButtonLink to={backHref} variant="secondary" className="mt-4">
            {t("booking.checkout.back_to_trip")}
          </ButtonLink>
        </Container>
      </>
    );
  }
  if (!methods) return <MethodsUnavailable />;
  return <CheckoutForm selection={selection} initialQuote={quote} methods={methods} boatName={boat?.name} profile={loaderData.profile} me={loaderData.me} />;
}

function MethodsUnavailable() {
  const t = useT();
  const revalidator = useRevalidator();
  return (
    <>
      <PageHero title={t("booking.checkout.title")} crumbs={[{ name: t("public.breadcrumb.home"), path: "/" }, { name: t("booking.checkout.title") }]} width="max-w-2xl" />
      <Container className="max-w-2xl pb-8 pt-6">
        <div className="mt-4">
          <ErrorState message={t("booking.checkout.methods_failed")} onRetry={() => revalidator.revalidate()} />
        </div>
      </Container>
    </>
  );
}

const LEAD_FIELDS = ["lead.full_name", "lead.phone", "lead.nationality", "lead.id_type", "lead.id_number", "lead.special_request"];
const CONSENT_FIELDS = ["consents.terms", "consents.cancellation", "consents.data_processing", "consents.deposit_forfeit"];

function isMappedField(key: string): boolean {
  return LEAD_FIELDS.includes(key) || CONSENT_FIELDS.includes(key) || key === "guests" || /^guests\.\d+\.(full_name|phone)$/.test(key) || key === "payment_method" || key === "payment_scheme" || key === "promo_code";
}

interface Guest {
  full_name: string;
  phone: string;
}

function CheckoutForm({
  selection,
  initialQuote,
  methods,
  boatName,
  profile,
  me,
}: {
  selection: NonNullable<Route.ComponentProps["loaderData"]["selection"]>;
  initialQuote: Quote;
  methods: PaymentMethodOption[];
  boatName?: string;
  profile: Profile | null;
  me: { email: string; full_name: string };
}) {
  const t = useT();
  const tc = useTCode();
  const locale = useLocale();
  const navigate = useNavigate();
  const errorText = useApiErrorText();
  const countries = useCountryOptions(COUNTRY_CODES);

  const initialNationality = profile?.nationality || "ID";
  const [fullName, setFullName] = useState(profile?.full_name || me.full_name);
  const [phone, setPhone] = useState(profile?.phone ?? "");
  const [nationality, setNationality] = useState(initialNationality);
  const [idType, setIdType] = useState<string>(idTypeOptions(initialNationality)[0]);
  const [idNumber, setIdNumber] = useState("");
  const [specialRequest, setSpecialRequest] = useState("");
  const [guests, setGuests] = useState<Guest[]>(() => Array.from({ length: Math.max(0, selection.pax - 1) }, () => ({ full_name: "", phone: "" })));
  const [method, setMethod] = useState("");
  const [scheme, setScheme] = useState<"FULL" | "DEPOSIT">("FULL");
  const [promo, setPromo] = useState("");
  const [consents, setConsents] = useState({ terms: false, cancellation: false, data_processing: false, deposit_forfeit: false });

  const quoteRequest: QuoteRequest = useMemo(
    () => ({ product: selection.product, pax: selection.pax, promo_code: promo || undefined, payment_method: method || undefined, payment_scheme: scheme, locale }),
    [selection, promo, method, scheme, locale],
  );
  const live = useLiveQuote(quoteRequest, initialQuote);
  const quote = live.quote ?? initialQuote;
  const depositAvailable = quote.payment.deposit_available;

  useEffect(() => {
    if (!depositAvailable && scheme === "DEPOSIT") setScheme("FULL");
  }, [depositAvailable, scheme]);

  const [submitError, setSubmitError] = useState<unknown>(null);
  const [methodMissing, setMethodMissing] = useState(false);
  const [pending, setPending] = useState(false);
  const [created, setCreated] = useState<Booking | null>(null);
  const bookingKey = useRef<KeyedContent | null>(null);
  const paymentKey = useRef<KeyedContent | null>(null);
  const fe = useFieldErrors(submitError);
  const unmapped = Object.entries(fe).filter(([k]) => !isMappedField(k));

  const body = {
    product: selection.product,
    pax: selection.pax,
    promo_code: promo || undefined,
    payment_method: method,
    payment_scheme: scheme,
    locale,
    lead: { full_name: fullName, phone, nationality, id_type: idType, id_number: idNumber, special_request: specialRequest },
    guests,
    consents: { ...consents, deposit_forfeit: scheme === "DEPOSIT" && consents.deposit_forfeit },
  };

  const statusPath = (id: string) => localePath(locale, `/orders/${id}/status`);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!method) {
      setMethodMissing(true);
      return;
    }
    setMethodMissing(false);
    setPending(true);
    setSubmitError(null);
    try {
      let booking = created;
      if (!booking) {
        bookingKey.current = nextIdempotencyKey(bookingKey.current, JSON.stringify(body), newIdempotencyKey);
        booking = await apiData<Booking>("/bookings", { method: "POST", body, idempotencyKey: bookingKey.current.key });
        setCreated(booking);
      }
      paymentKey.current = nextIdempotencyKey(paymentKey.current, `${booking.id}:${method}`, newIdempotencyKey);
      const payment = await createPayment(booking.id, method, paymentKey.current.key);
      const id = booking.id;
      await openPayment(payment, () => navigate(statusPath(id)));
    } catch (err) {
      setSubmitError(err);
    } finally {
      setPending(false);
    }
  }

  const setGuest = (i: number, patch: Partial<Guest>) => setGuests((gs) => gs.map((g, j) => (j === i ? { ...g, ...patch } : g)));
  const link = (path: string, label: string) => (
    <Link to={localePath(locale, path)} target="_blank" rel="noopener" className="text-primary underline">
      {label}
    </Link>
  );

  return (
    <>
      <PageHero title={t("booking.checkout.title")} crumbs={[{ name: t("public.breadcrumb.home"), path: "/" }, { name: t("booking.checkout.title") }]} />
      <Container className="pb-8 pt-6">
        <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <aside className="lg:order-2">
            <div className="lg:sticky lg:top-20">
              <QuoteSummary quote={quote} boatName={boatName} loading={live.loading} error={live.error ? errorText(live.error) : null} />
            </div>
          </aside>
          <form onSubmit={submit} noValidate className="min-w-0 space-y-6 lg:order-1">
            {created && (
              <Alert tone="info" title={t("booking.checkout.created_title", { number: created.booking_number })}>
                {t("booking.checkout.created_body")}{" "}
                <Link to={localePath(locale, `/account/bookings/${created.id}`)} className="text-primary underline">
                  {t("booking.checkout.view_booking")}
                </Link>
              </Alert>
            )}
            <fieldset disabled={!!created || pending} className="space-y-6">
              <Card>
                <h2 className="text-lg font-semibold">{t("booking.lead.title")}</h2>
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <Field label={t("booking.lead.full_name")} required error={fe["lead.full_name"]} className="sm:col-span-2">
                    {(p) => <Input {...p} autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} required maxLength={120} />}
                  </Field>
                  <Field label={t("booking.lead.email")} hint={t("booking.lead.email_hint")}>
                    {(p) => <Input {...p} type="email" value={me.email} readOnly />}
                  </Field>
                  <Field label={t("booking.lead.phone")} required error={fe["lead.phone"]}>
                    {(p) => <PhoneInput id={p.id} value={phone} onChange={setPhone} invalid={p["aria-invalid"]} describedBy={p["aria-describedby"]} />}
                  </Field>
                  <Field label={t("booking.lead.nationality")} required error={fe["lead.nationality"]}>
                    {(p) => (
                      <SearchableSelect
                        id={p.id}
                        value={nationality}
                        options={countries}
                        invalid={p["aria-invalid"]}
                        describedBy={p["aria-describedby"]}
                        onChange={(v) => {
                          setNationality(v);
                          setIdType((cur) => coerceIdType(v, cur));
                        }}
                      />
                    )}
                  </Field>
                  <Field label={t("booking.lead.id_type")} required error={fe["lead.id_type"]}>
                    {(p) => (
                      <Select {...p} value={idType} onChange={(e) => setIdType(e.target.value)}>
                        {idTypeOptions(nationality).map((o) => (
                          <option key={o} value={o}>
                            {tc("booking.id_types", o)}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                  <Field label={t("booking.lead.id_number")} required error={fe["lead.id_number"]} hint={idType === "KTP" ? t("booking.lead.id_hint_ktp") : t("booking.lead.id_hint")} className="sm:col-span-2">
                    {(p) => <Input {...p} value={idNumber} onChange={(e) => setIdNumber(e.target.value)} required autoComplete="off" inputMode={idType === "KTP" || idType === "SIM" ? "numeric" : "text"} maxLength={40} />}
                  </Field>
                  <Field label={t("booking.lead.special_request")} error={fe["lead.special_request"]} className="sm:col-span-2">
                    {(p) => <Textarea {...p} value={specialRequest} onChange={(e) => setSpecialRequest(e.target.value)} maxLength={1000} />}
                  </Field>
                </div>
              </Card>

              {guests.length > 0 && (
                <Card>
                  <h2 className="text-lg font-semibold">{t("booking.guests.title")}</h2>
                  <p className="mt-1 text-sm text-muted">{t("booking.guests.hint", { count: guests.length })}</p>
                  {fe["guests"] && (
                    <Alert tone="danger" className="mt-3">
                      {fe["guests"]}
                    </Alert>
                  )}
                  <ol className="mt-3 space-y-4">
                    {guests.map((g, i) => (
                      <li key={i}>
                        <fieldset className="grid gap-3 sm:grid-cols-2">
                          <legend className="mb-2 text-sm font-medium">{t("booking.guests.guest", { number: i + 2 })}</legend>
                          <Field label={t("booking.guests.full_name")} required error={fe[`guests.${i}.full_name`]}>
                            {(p) => <Input {...p} value={g.full_name} onChange={(e) => setGuest(i, { full_name: e.target.value })} required maxLength={120} />}
                          </Field>
                          <Field label={t("booking.guests.phone")} error={fe[`guests.${i}.phone`]}>
                            {(p) => <PhoneInput id={p.id} value={g.phone} onChange={(v) => setGuest(i, { phone: v })} invalid={p["aria-invalid"]} describedBy={p["aria-describedby"]} />}
                          </Field>
                        </fieldset>
                      </li>
                    ))}
                  </ol>
                </Card>
              )}

              <Card className="space-y-5">
                <h2 className="text-lg font-semibold">{t("booking.payment.title")}</h2>
                <PaymentMethodPicker methods={methods} value={method} onChange={setMethod} error={methodMissing ? t("booking.payment.choose_method") : fe["payment_method"]} />
                {depositAvailable && (
                  <fieldset>
                    <legend className="text-sm font-medium">{t("booking.payment.scheme")}</legend>
                    <div className="mt-2 space-y-2 text-sm">
                      <label className="flex items-start gap-2">
                        <input type="radio" name="payment_scheme" checked={scheme === "FULL"} onChange={() => setScheme("FULL")} className="mt-0.5" />
                        <span>
                          {t("booking.payment.full")} · <Money amount={quote.grand_total} />
                        </span>
                      </label>
                      <label className="flex items-start gap-2">
                        <input type="radio" name="payment_scheme" checked={scheme === "DEPOSIT"} onChange={() => setScheme("DEPOSIT")} className="mt-0.5" />
                        <span>
                          {t("booking.payment.deposit")} · <Money amount={quote.payment.deposit_amount} />
                        </span>
                      </label>
                    </div>
                    {fe["payment_scheme"] && <p className="mt-1 text-xs text-danger">{fe["payment_scheme"]}</p>}
                  </fieldset>
                )}
                <PromoCode applied={promo} onApplied={setPromo} request={quoteRequest} />
              </Card>

              <Card>
                <h2 className="text-lg font-semibold">{t("booking.consents.title")}</h2>
                <div className="mt-3 space-y-3">
                  <ConsentBox checked={consents.terms} onChange={(v) => setConsents((c) => ({ ...c, terms: v }))} error={fe["consents.terms"]} label={<>{t("booking.consents.terms")} {link("/terms", t("booking.consents.read"))}</>} />
                  <ConsentBox
                    checked={consents.cancellation}
                    onChange={(v) => setConsents((c) => ({ ...c, cancellation: v }))}
                    error={fe["consents.cancellation"]}
                    label={<>{t("booking.consents.cancellation")} {link("/cancellation-policy", t("booking.consents.read"))}</>}
                  />
                  <ConsentBox
                    checked={consents.data_processing}
                    onChange={(v) => setConsents((c) => ({ ...c, data_processing: v }))}
                    error={fe["consents.data_processing"]}
                    label={<>{t("booking.consents.data_processing")} {link("/privacy", t("booking.consents.read"))}</>}
                  />
                  {scheme === "DEPOSIT" && (
                    <ConsentBox checked={consents.deposit_forfeit} onChange={(v) => setConsents((c) => ({ ...c, deposit_forfeit: v }))} error={fe["consents.deposit_forfeit"]} label={t("booking.consents.deposit_forfeit")} />
                  )}
                </div>
              </Card>
            </fieldset>

            {submitError !== null && (
              <div className="space-y-2">
                <ApiErrorMessage error={submitError} />
                {unmapped.length > 0 && (
                  <ul className="list-inside list-disc text-sm text-danger">
                    {unmapped.map(([k, msg]) => (
                      <li key={k}>{msg}</li>
                    ))}
                  </ul>
                )}
                {submitError instanceof ApiError && ["BOOKING_SLOT_TAKEN", "BOOKING_CAPACITY_EXCEEDED", "BOOKING_CLOSED", "PRODUCT_NOT_FOUND"].includes(submitError.code) && (
                  <Link to={localePath(locale, selection.boatSlug ? `/boats/${selection.boatSlug}` : "/boats")} className="text-sm text-primary underline">
                    {t("booking.checkout.back_to_trip")}
                  </Link>
                )}
              </div>
            )}

            <div className="space-y-2">
              <p className="flex justify-between text-sm font-semibold">
                <span>{t("booking.summary.due_now")}</span>
                <Money amount={quote.payment.total_due_now} />
              </p>
              <Button type="submit" size="lg" full pending={pending}>
                {created ? t("booking.checkout.retry_payment") : t("booking.checkout.submit")}
              </Button>
              <p className="text-xs text-muted">{t("booking.checkout.submit_note")}</p>
            </div>
          </form>
        </div>
      </Container>
    </>
  );
}

function ConsentBox({ checked, onChange, label, error }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; error?: string }) {
  return (
    <div>
      <Checkbox checked={checked} onChange={(e) => onChange(e.target.checked)} label={label} required aria-invalid={error ? true : undefined} />
      {error && <p className="ml-6 mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}

// PromoCode validates a code with a server quote before applying it, so an invalid code never
// replaces the price the customer is looking at.
function PromoCode({ applied, onApplied, request }: { applied: string; onApplied: (code: string) => void; request: QuoteRequest }) {
  const t = useT();
  const errorText = useApiErrorText();
  const [input, setInput] = useState(applied);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const ctrl = useRef<AbortController | null>(null);
  useEffect(() => () => ctrl.current?.abort(), []);

  async function apply() {
    const code = input.trim().toUpperCase();
    if (!code) return;
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setPending(true);
    setError(null);
    try {
      await apiData<Quote>("/quotes", { method: "POST", body: { ...request, promo_code: code }, signal: c.signal });
      onApplied(code);
      setInput(code);
    } catch (e) {
      if (!c.signal.aborted) setError(e);
    } finally {
      if (!c.signal.aborted) setPending(false);
    }
  }

  if (applied) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span>{t("booking.promo.applied", { code: applied })}</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            onApplied("");
            setInput("");
          }}
        >
          {t("booking.promo.remove")}
        </Button>
      </div>
    );
  }
  return (
    <Field label={t("booking.promo.label")} error={error ? errorText(error) : undefined}>
      {(p) => (
        <div className="flex gap-2">
          <Input
            {...p}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void apply();
              }
            }}
            autoComplete="off"
            maxLength={40}
          />
          <Button variant="secondary" onClick={() => void apply()} pending={pending} disabled={!input.trim()}>
            {t("booking.promo.apply")}
          </Button>
        </div>
      )}
    </Field>
  );
}
