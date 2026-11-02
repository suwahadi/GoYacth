import { useState, type FormEvent } from "react";
import { useRevalidator } from "react-router";

import { ApiErrorMessage, Button, Card, Field, Input, Select, StatusBadge, Textarea, useFieldErrors, useToast } from "~/components/ui";
import { Stars } from "~/features/public/components";
import { api } from "~/lib/api";
import { useLocale, useT, type TKey } from "~/lib/i18n";

import type { OwnReview } from "./types";

const RATINGS: { key: "rating_overall" | "rating_boat" | "rating_service" | "rating_crew"; label: TKey }[] = [
  { key: "rating_overall", label: "account.review.rating_overall" },
  { key: "rating_boat", label: "account.review.rating_boat" },
  { key: "rating_service", label: "account.review.rating_service" },
  { key: "rating_crew", label: "account.review.rating_crew" },
];

export function ReviewSection({ bookingId, review, canReview }: { bookingId: string; review: OwnReview | null; canReview: boolean }) {
  const t = useT();
  if (review) {
    return (
      <Card>
        <h2 className="text-lg font-semibold">{t("account.review.yours")}</h2>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <Stars rating={review.rating_overall} />
          <StatusBadge status={review.status} />
        </div>
        <p className="mt-2 font-medium">{review.title}</p>
        <p className="mt-1 whitespace-pre-line text-sm">{review.body}</p>
      </Card>
    );
  }
  if (!canReview) return null;
  return <ReviewForm bookingId={bookingId} />;
}

function ReviewForm({ bookingId }: { bookingId: string }) {
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const revalidator = useRevalidator();
  const [ratings, setRatings] = useState({ rating_overall: 5, rating_boat: 5, rating_service: 5, rating_crew: 5 });
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const fe = useFieldErrors(error);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api(`/bookings/${bookingId}/review`, { method: "POST", body: { ...ratings, title, body, locale } });
      toast(t("account.review.thanks"));
      revalidator.revalidate();
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <h2 className="text-lg font-semibold">{t("account.review.title")}</h2>
      <form onSubmit={submit} className="mt-3 space-y-4" noValidate>
        <div className="grid gap-3 sm:grid-cols-2">
          {RATINGS.map((r) => (
            <Field key={r.key} label={t(r.label)} required error={fe[r.key]}>
              {(p) => (
                <Select {...p} value={ratings[r.key]} onChange={(e) => setRatings((cur) => ({ ...cur, [r.key]: Number(e.target.value) }))}>
                  {[5, 4, 3, 2, 1].map((n) => (
                    <option key={n} value={n}>
                      {t("account.review.stars", { rating: n })}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ))}
        </div>
        <Field label={t("account.review.headline")} required error={fe["title"]} hint={t("account.review.headline_hint")}>
          {(p) => <Input {...p} value={title} onChange={(e) => setTitle(e.target.value)} required minLength={3} maxLength={120} />}
        </Field>
        <Field label={t("account.review.body")} required error={fe["body"]} hint={t("account.review.body_hint")}>
          {(p) => <Textarea {...p} value={body} onChange={(e) => setBody(e.target.value)} required minLength={10} maxLength={4000} />}
        </Field>
        <ApiErrorMessage error={error} />
        <Button type="submit" pending={pending}>
          {t("account.review.submit")}
        </Button>
      </form>
    </Card>
  );
}
