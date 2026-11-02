import { useState } from "react";

import { Button, Dialog } from "~/components/ui";
import { api } from "~/lib/api";
import { useLocale, useT } from "~/lib/i18n";
import type { Review } from "~/lib/types";

import { ReviewList, ReviewSummary, SectionError, type ReviewStats } from "./components";

const PER_PAGE = 6;

// BoatReviews shows only the averages on the page. The reviews themselves open in a dialog from
// the "Rated by guests" line, and further pages load inside it.
export function BoatReviews({ boatId, stats, initial }: { boatId: string; stats: ReviewStats | null; initial: Review[] | null }) {
  const t = useT();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [reviews, setReviews] = useState<Review[]>(initial ?? []);
  const [page, setPage] = useState(1);
  const [done, setDone] = useState((initial?.length ?? 0) < PER_PAGE);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  if (initial === null) return <SectionError />;
  if (!stats || stats.total === 0 || reviews.length === 0) return <p className="text-muted">{t("public.reviews.empty")}</p>;

  const more = async () => {
    setLoading(true);
    setFailed(false);
    try {
      const res = await api<Review[]>("/reviews", {
        query: { locale, boat_id: boatId, per_page: PER_PAGE, page: page + 1 },
      });
      const seen = new Set(reviews.map((r) => r.id));
      setReviews([...reviews, ...res.data.filter((r) => !seen.has(r.id))]);
      setPage(page + 1);
      if (res.data.length < PER_PAGE) setDone(true);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <ReviewSummary stats={stats} onOpen={() => setOpen(true)} />
      <Dialog open={open} onClose={() => setOpen(false)} title={t("public.boat.reviews")} size="lg">
        <ReviewList reviews={reviews} columns={1} />
        {failed && <p className="mt-6 text-sm text-danger">{t("public.boat.section_error")}</p>}
        {!done && (
          <div className="mt-8 text-center">
            <Button variant="secondary" onClick={more} pending={loading}>
              {t("common.actions.load_more")}
            </Button>
          </div>
        )}
      </Dialog>
    </>
  );
}
