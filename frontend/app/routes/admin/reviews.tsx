import { Link, useNavigation, useRevalidator, useSearchParams } from "react-router";

import type { Route } from "./+types/reviews";
import { Button, EmptyState, FilterBar, Select, SkeletonList, useToast } from "~/components/ui";
import { settle } from "~/features/admin-catalog/data";
import type { AdminReview, ReviewStatus } from "~/features/admin-catalog/types";
import { FormError, LoadFailed, PageHeader, StatusPill, adminMeta, enumLabel, useSubmission } from "~/features/admin-catalog/ui";
import { api, apiData } from "~/lib/api";
import { formatDateTime } from "~/lib/format";
import { adminT } from "~/lib/i18n";

const STATUSES: ReviewStatus[] = ["PENDING", "PUBLISHED", "REJECTED"];
const PER_PAGE = 25;

export function meta() {
  return adminMeta("catalog.reviews.title");
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const status = url.searchParams.get("status") ?? "PENDING";
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  return { page, result: await settle(apiData<AdminReview[]>("/admin/reviews", { request, query: { status: status === "ALL" ? undefined : status, page, per_page: PER_PAGE } })) };
}

export default function Reviews({ loaderData }: Route.ComponentProps) {
  const { result, page } = loaderData;
  const [params, setParams] = useSearchParams();
  const nav = useNavigation();
  const status = params.get("status") ?? "PENDING";
  const pageHref = (p: number) => {
    const next = new URLSearchParams(params);
    next.set("page", String(p));
    return `?${next.toString()}`;
  };
  return (
    <div className="space-y-4">
      <PageHeader title={adminT("catalog.reviews.title")} />
      <FilterBar activeCount={status !== "PENDING" ? 1 : 0} onClear={() => setParams({})}>
        <label className="space-y-1 text-sm">
          <span className="block font-medium">{adminT("catalog.fields.status")}</span>
          <Select value={status} onChange={(e) => setParams({ status: e.target.value })}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {enumLabel("status", s)}
              </option>
            ))}
            <option value="ALL">{adminT("catalog.common.all")}</option>
          </Select>
        </label>
      </FilterBar>
      {nav.state === "loading" && nav.location?.pathname === "/admin/reviews" ? (
        <SkeletonList />
      ) : !result.ok ? (
        <LoadFailed code={result.code} />
      ) : result.data.length === 0 ? (
        <EmptyState title={adminT("catalog.reviews.empty")} />
      ) : (
        <ul className="space-y-3">
          {result.data.map((r) => (
            <ReviewCard key={r.id} review={r} />
          ))}
        </ul>
      )}
      {result.ok && (page > 1 || result.data.length === PER_PAGE) && (
        <nav aria-label={adminT("catalog.common.pagination")} className="grid grid-cols-2 gap-2 text-sm">
          {page > 1 ? (
            <Link className="rounded-md border border-border px-3 py-1.5 text-center" to={pageHref(page - 1)}>
              {adminT("catalog.common.previous")}
            </Link>
          ) : (
            <span />
          )}
          {result.data.length === PER_PAGE && (
            <Link className="rounded-md border border-border px-3 py-1.5 text-center" to={pageHref(page + 1)}>
              {adminT("catalog.common.next")}
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}

function ReviewCard({ review }: { review: AdminReview }) {
  const s = useSubmission();
  const toast = useToast();
  const rv = useRevalidator();
  const moderate = async (status: ReviewStatus, featured: boolean) => {
    const ok = await s.run(async (signal) => {
      await api(`/admin/reviews/${review.id}/moderate`, { method: "POST", body: { status, is_featured: featured }, signal });
    });
    if (ok) {
      toast(adminT("catalog.reviews.updated"));
      rv.revalidate();
    }
  };
  return (
    <li>
      <article className="space-y-2 rounded-lg border border-border bg-surface p-4">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">{review.title}</h2>
          <div className="flex items-center gap-2">
            {review.is_featured && <span className="text-xs font-medium">{adminT("catalog.reviews.featured")}</span>}
            <StatusPill status={review.status} />
          </div>
        </header>
        <p className="text-sm text-muted">
          {adminT("catalog.reviews.byline", { author: review.author_name, booking: review.booking_number, date: formatDateTime(review.created_at, "UTC", "en"), locale: review.locale.toUpperCase() })}
        </p>
        <dl className="grid grid-cols-2 gap-x-4 text-sm sm:grid-cols-4">
          {(["rating_overall", "rating_boat", "rating_service", "rating_crew"] as const).map((k) => (
            <div key={k}>
              <dt className="text-muted">{adminT(`catalog.reviews.${k}`)}</dt>
              <dd>{adminT("catalog.reviews.stars", { n: review[k] })}</dd>
            </div>
          ))}
        </dl>
        <p className="whitespace-pre-line text-sm">{review.body}</p>
        <FormError error={s.error} />
        <div className="flex flex-wrap gap-2">
          {review.status !== "PUBLISHED" && (
            <Button size="sm" pending={s.pending} onClick={() => void moderate("PUBLISHED", false)}>
              {adminT("catalog.reviews.publish")}
            </Button>
          )}
          {review.status === "PUBLISHED" && (
            <Button size="sm" variant="secondary" pending={s.pending} onClick={() => void moderate("PUBLISHED", !review.is_featured)}>
              {review.is_featured ? adminT("catalog.reviews.unfeature") : adminT("catalog.reviews.feature")}
            </Button>
          )}
          {review.status !== "REJECTED" && (
            <Button size="sm" variant="danger" pending={s.pending} onClick={() => void moderate("REJECTED", false)}>
              {adminT("catalog.reviews.reject")}
            </Button>
          )}
          {review.status !== "PENDING" && (
            <Button size="sm" variant="ghost" pending={s.pending} onClick={() => void moderate("PENDING", false)}>
              {adminT("catalog.reviews.back_to_pending")}
            </Button>
          )}
        </div>
      </article>
    </li>
  );
}
