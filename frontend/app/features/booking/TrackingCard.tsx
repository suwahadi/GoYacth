import { ButtonLink, Card, StatusBadge } from "~/components/ui";
import { localePath } from "~/lib/config";
import { formatDateTime } from "~/lib/format";
import { useLocale, useT } from "~/lib/i18n";
import type { Tracking } from "~/lib/types";

// TrackingCard is the public view of a booking. It never shows names, phones, IDs or guests.
export function TrackingCard({ tracking }: { tracking: Tracking }) {
  const t = useT();
  const locale = useLocale();
  return (
    <Card>
      <h2 className="text-lg font-semibold">{t("booking.track.booking_number", { number: tracking.booking_number })}</h2>
      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted">{t("booking.track.status")}</dt>
          <dd>
            <StatusBadge status={tracking.status} />
          </dd>
        </div>
        <div>
          <dt className="text-muted">{t("booking.track.payment_status")}</dt>
          <dd>
            <StatusBadge status={tracking.payment_status} />
          </dd>
        </div>
        <div>
          <dt className="text-muted">{t("booking.track.date")}</dt>
          <dd>{formatDateTime(tracking.starts_at, tracking.timezone, locale)}</dd>
        </div>
        <div>
          <dt className="text-muted">{t("booking.track.boat")}</dt>
          <dd>{tracking.boat_name}</dd>
        </div>
        <div>
          <dt className="text-muted">{t("booking.track.route")}</dt>
          <dd>{tracking.route_name}</dd>
        </div>
      </dl>
      <ButtonLink to={localePath(locale, `/account/bookings/${tracking.id}`)} variant="secondary" className="mt-4">
        {t("common.actions.view_details")}
      </ButtonLink>
      <p className="mt-2 text-xs text-muted">{t("booking.track.details_login")}</p>
    </Card>
  );
}
