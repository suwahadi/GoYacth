import { data } from "react-router";

import type { Route } from "./+types/order";
import { ButtonLink, Container, ErrorState, useApiErrorText } from "~/components/ui";
import { privateHeaders } from "~/features/account/session";
import { privateMeta } from "~/features/booking/meta";
import { deserializeError, responseStatus, serializeError } from "~/features/booking/routeErrors";
import { TrackingCard } from "~/features/booking/TrackingCard";
import { apiData } from "~/lib/api";
import { localePath, splitLocale } from "~/lib/config";
import { useLocale, useT } from "~/lib/i18n";
import type { Tracking } from "~/lib/types";
import { PageHero } from "~/features/public/components";

export async function loader({ request, params }: Route.LoaderArgs) {
  const { locale } = splitLocale(new URL(request.url).pathname);
  try {
    const tracking = await apiData<Tracking>(`/orders/${encodeURIComponent(params.id)}`, { request, query: { locale } });
    return data({ tracking, error: null }, { headers: privateHeaders });
  } catch (e) {
    const error = serializeError(e);
    return data({ tracking: null, error }, { status: responseStatus(error), headers: privateHeaders });
  }
}

export function headers() {
  return privateHeaders;
}

export function meta({ location }: Route.MetaArgs) {
  return privateMeta(location, "booking.track.order_title");
}

export default function Order({ loaderData }: Route.ComponentProps) {
  const t = useT();
  const locale = useLocale();
  const errorText = useApiErrorText();
  return (
    <>
      <PageHero title={t("booking.track.order_title")} crumbs={[{ name: t("public.breadcrumb.home"), path: "/" }, { name: t("booking.track.order_title") }]} width="max-w-xl" />
      <Container className="max-w-xl pb-8 pt-6">
        <div className="mt-4">
          {loaderData.tracking ? (
            <TrackingCard tracking={loaderData.tracking} />
          ) : (
            <>
              <ErrorState message={errorText(deserializeError(loaderData.error))} />
              <ButtonLink to={localePath(locale, "/track")} variant="secondary" className="mt-4">
                {t("booking.track.title")}
              </ButtonLink>
            </>
          )}
        </div>
      </Container>
    </>
  );
}
