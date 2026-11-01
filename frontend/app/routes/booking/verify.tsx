import { data } from "react-router";

import type { Route } from "./+types/verify";
import { Card, Container, ErrorState, StatusBadge, cn, useApiErrorText } from "~/components/ui";
import { privateHeaders } from "~/features/account/session";
import { privateMeta } from "~/features/booking/meta";
import { deserializeError, responseStatus, serializeError } from "~/features/booking/routeErrors";
import type { VerifyResult } from "~/features/booking/types";
import { apiData } from "~/lib/api";
import { splitLocale } from "~/lib/config";
import { formatDateTime } from "~/lib/format";
import { useLocale, useT } from "~/lib/i18n";

export async function loader({ request, params }: Route.LoaderArgs) {
  const { locale } = splitLocale(new URL(request.url).pathname);
  try {
    const result = await apiData<VerifyResult>(`/verify/${encodeURIComponent(params.token)}`, { query: { locale } });
    return data({ result, error: null }, { headers: privateHeaders });
  } catch (e) {
    const error = serializeError(e);
    return data({ result: null, error }, { status: responseStatus(error), headers: privateHeaders });
  }
}

export function headers() {
  return privateHeaders;
}

export function meta({ location }: Route.MetaArgs) {
  return privateMeta(location, "booking.verify.title");
}

export default function Verify({ loaderData }: Route.ComponentProps) {
  const t = useT();
  const locale = useLocale();
  const errorText = useApiErrorText();
  const r = loaderData.result;
  return (
    <Container className="max-w-md py-8">
      <h1 className="text-2xl font-bold">{t("booking.verify.title")}</h1>
      {!r ? (
        <div className="mt-4">
          <ErrorState message={loaderData.error?.status === 404 ? t("booking.verify.not_found") : errorText(deserializeError(loaderData.error))} />
        </div>
      ) : (
        <>
          <div role="status" className={cn("mt-4 rounded-lg border p-6 text-center", r.valid ? "border-success bg-success-bg text-success" : "border-danger bg-danger-bg text-danger")}>
            <p className="text-5xl font-bold" aria-hidden="true">
              {r.valid ? "✓" : "✕"}
            </p>
            <p className="mt-2 text-2xl font-bold">{r.valid ? t("booking.verify.valid") : t("booking.verify.invalid")}</p>
            <div className="mt-2">
              <StatusBadge status={r.status} />
            </div>
          </div>
          <Card className="mt-4">
            <dl className="space-y-2 text-sm">
              <div>
                <dt className="text-muted">{t("booking.status.booking_number")}</dt>
                <dd className="font-medium">{r.booking_number}</dd>
              </div>
              <div>
                <dt className="text-muted">{t("booking.track.date")}</dt>
                <dd>{formatDateTime(r.starts_at, r.timezone, locale)}</dd>
              </div>
              <div>
                <dt className="text-muted">{t("booking.track.boat")}</dt>
                <dd>{r.boat_name}</dd>
              </div>
              <div>
                <dt className="text-muted">{t("booking.summary.guests")}</dt>
                <dd>{t("common.units.pax", { count: r.pax })}</dd>
              </div>
              <div>
                <dt className="text-muted">{t("booking.verify.lead")}</dt>
                <dd>{r.lead_name}</dd>
              </div>
            </dl>
          </Card>
        </>
      )}
    </Container>
  );
}
