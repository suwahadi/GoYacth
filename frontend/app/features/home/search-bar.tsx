import { useId, useState, type ReactNode } from "react";

import { Button, CalendarIcon, ChevronDownIcon, MapPinIcon, SearchIcon, UsersIcon, YachtMark, cn } from "~/components/ui";
import { localePath } from "~/lib/config";
import { useLocale, useT } from "~/lib/i18n";
import type { RegionCard } from "~/lib/types";

import { homeWidth } from "./sections";

const GUEST_OPTIONS = [2, 4, 6, 8, 10, 15, 20, 30, 50];

const controlClass = "h-11 max-w-full lg:h-7 cursor-pointer appearance-none bg-transparent pr-6 text-[clamp(0.9375rem,0.8rem+0.25vw,1.0625rem)] font-semibold text-fg field-sizing-content";

// The native picker stays usable: its indicator stretches invisibly over the field, under our chevron.
const dateClass = "relative focus:outline-2 focus:outline-offset-2 focus:outline-focus [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:size-full [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-0";

function Field({ icon, label, children }: { icon: ReactNode; label: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2 lg:border-l lg:border-border lg:px-5 lg:first:border-l-0">
      <span className="shrink-0 text-primary">{icon}</span>
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="block text-[0.8125rem] leading-4 text-muted">
          {label}
        </label>
        <div className="relative inline-block max-w-full">{children(id)}</div>
      </div>
    </div>
  );
}

function Chevron() {
  return <ChevronDownIcon className="pointer-events-none absolute right-0 top-3.5 size-4 text-primary lg:top-1.5" />;
}

// A plain GET form works without JavaScript and leaves a shareable results URL. Departures have no
// region or guest filter, so those fields leave the form instead of doing nothing.
export function SearchBar({ regions, overlapsHero = true }: { regions: RegionCard[]; overlapsHero?: boolean }) {
  const t = useT();
  const locale = useLocale();
  const [mode, setMode] = useState("charter");
  const charter = mode === "charter";
  return (
    <div className={cn(homeWidth, "relative z-10", overlapsHero ? "-mt-16" : "mt-6")}>
      <form
        role="search"
        aria-label={t("public.home.search.label")}
        method="get"
        action={localePath(locale, charter ? "/boats" : "/departures")}
        className="grid grid-cols-1 gap-1 rounded-2xl bg-surface p-3 shadow-lg shadow-ink/15 sm:grid-cols-2 lg:flex lg:items-center lg:gap-0"
      >
        <Field icon={<YachtMark className="h-5 w-9" />} label={t("public.home.search.mode")}>
          {(id) => (
            <>
              <select id={id} value={mode} onChange={(e) => setMode(e.target.value)} className={controlClass}>
                <option value="charter">{t("public.home.search.mode_charter")}</option>
                <option value="departure">{t("public.home.search.mode_departure")}</option>
              </select>
              <Chevron />
            </>
          )}
        </Field>
        <Field icon={<CalendarIcon className="size-7" />} label={t("public.home.search.date")}>
          {(id) => (
            <>
              <input id={id} type="date" name="date" className={cn(controlClass, dateClass)} />
              <Chevron />
            </>
          )}
        </Field>
        {charter && (
          <>
            <Field icon={<MapPinIcon className="size-7" />} label={t("public.home.search.from")}>
              {(id) => (
                <>
                  <select id={id} name="region_id" defaultValue="" className={controlClass}>
                    <option value="">{t("public.home.search.all_regions")}</option>
                    {regions
                      .filter((r) => r.slug)
                      .map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                  </select>
                  <Chevron />
                </>
              )}
            </Field>
            <Field icon={<UsersIcon className="size-7" />} label={t("public.home.search.guests")}>
              {(id) => (
                <>
                  <select id={id} name="pax" defaultValue="2" className={controlClass}>
                    {GUEST_OPTIONS.map((n) => (
                      <option key={n} value={n}>
                        {t("public.home.search.guests_option", { count: n })}
                      </option>
                    ))}
                  </select>
                  <Chevron />
                </>
              )}
            </Field>
          </>
        )}
        <Button type="submit" variant="accent" size="lg" className="cursor-pointer rounded-xl! sm:col-span-2 lg:ml-3 lg:w-40" icon={<SearchIcon className="size-5" />}>
          {t("public.home.search.submit")}
        </Button>
      </form>
    </div>
  );
}
