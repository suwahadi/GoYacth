import { useState, type FormEvent } from "react";
import { data, useRevalidator } from "react-router";

import type { Route } from "./+types/profile";
import {
  ApiErrorMessage,
  Button,
  Card,
  ConfirmDialog,
  ErrorState,
  Field,
  Input,
  PhoneInput,
  SearchableSelect,
  Select,
  useApiErrorText,
  useCountryOptions,
  useFieldErrors,
  useToast,
} from "~/components/ui";
import { isUnauthenticated, loginRedirect, privateHeaders } from "~/features/account/session";
import type { Profile } from "~/features/account/types";
import { privateMeta } from "~/features/booking/meta";
import { deserializeError, responseStatus, serializeError } from "~/features/booking/routeErrors";
import { api, apiData } from "~/lib/api";
import { LOCALES, localePath } from "~/lib/config";
import { COUNTRY_CODES } from "~/lib/countries";
import { useLocale, useT } from "~/lib/i18n";

export async function loader({ request }: Route.LoaderArgs) {
  try {
    const profile = await apiData<Profile>("/account/profile", { request });
    return data({ profile, error: null }, { headers: privateHeaders });
  } catch (e) {
    if (isUnauthenticated(e)) throw loginRedirect(request);
    const error = serializeError(e);
    return data({ profile: null, error }, { status: responseStatus(error), headers: privateHeaders });
  }
}

export function headers() {
  return privateHeaders;
}

export function meta({ location }: Route.MetaArgs) {
  return privateMeta(location, "account.profile.title");
}

export default function AccountProfile({ loaderData }: Route.ComponentProps) {
  const errorText = useApiErrorText();
  const revalidator = useRevalidator();
  if (!loaderData.profile) return <ErrorState message={errorText(deserializeError(loaderData.error))} onRetry={() => revalidator.revalidate()} />;
  return (
    <div className="space-y-6">
      <ProfileForm profile={loaderData.profile} />
      <DeleteAccount />
    </div>
  );
}

function ProfileForm({ profile }: { profile: Profile }) {
  const t = useT();
  const toast = useToast();
  const revalidator = useRevalidator();
  const countries = useCountryOptions(COUNTRY_CODES);
  const [fullName, setFullName] = useState(profile.full_name);
  const [phone, setPhone] = useState(profile.phone);
  const [nationality, setNationality] = useState(profile.nationality || "ID");
  const [preferredLocale, setPreferredLocale] = useState(profile.locale || "en");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const fe = useFieldErrors(error);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api("/account/profile", { method: "PUT", body: { full_name: fullName, phone, nationality, locale: preferredLocale } });
      toast(t("account.profile.saved"));
      revalidator.revalidate();
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <h2 className="text-lg font-semibold">{t("account.profile.title")}</h2>
      <form onSubmit={submit} className="mt-4 grid gap-4 sm:grid-cols-2" noValidate>
        <Field label={t("account.profile.full_name")} required error={fe["full_name"]} className="sm:col-span-2">
          {(p) => <Input {...p} value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" required maxLength={120} />}
        </Field>
        <Field label={t("account.profile.email")} hint={t("account.profile.email_hint")}>
          {(p) => <Input {...p} type="email" value={profile.email} readOnly />}
        </Field>
        <Field label={t("account.profile.phone")} error={fe["phone"]}>
          {(p) => <PhoneInput id={p.id} value={phone} onChange={setPhone} invalid={p["aria-invalid"]} describedBy={p["aria-describedby"]} />}
        </Field>
        <Field label={t("account.profile.nationality")} required error={fe["nationality"]}>
          {(p) => <SearchableSelect id={p.id} value={nationality} onChange={setNationality} options={countries} invalid={p["aria-invalid"]} describedBy={p["aria-describedby"]} />}
        </Field>
        <Field label={t("account.profile.language")} error={fe["locale"]}>
          {(p) => (
            <Select {...p} value={preferredLocale} onChange={(e) => setPreferredLocale(e.target.value)}>
              {LOCALES.map((l) => (
                <option key={l} value={l}>
                  {t(`common.language.${l}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="space-y-3 sm:col-span-2">
          <ApiErrorMessage error={error} />
          <Button type="submit" pending={pending}>
            {t("common.actions.save")}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function DeleteAccount() {
  const t = useT();
  const locale = useLocale();
  const errorText = useApiErrorText();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function confirm() {
    setPending(true);
    setError(null);
    try {
      await api("/account/delete", { method: "POST" });
      window.location.href = localePath(locale, "/");
    } catch (err) {
      setError(err);
      setOpen(false);
      setPending(false);
    }
  }

  return (
    <Card>
      <h2 className="text-lg font-semibold">{t("account.delete.title")}</h2>
      <p className="mt-2 text-sm text-muted">{t("account.delete.body")}</p>
      {error !== null && <p className="mt-3 text-sm text-danger" role="alert">{errorText(error)}</p>}
      <Button variant="danger" className="mt-4" onClick={() => setOpen(true)}>
        {t("account.delete.action")}
      </Button>
      <ConfirmDialog
        open={open}
        title={t("account.delete.confirm_title")}
        body={t("account.delete.confirm_body")}
        confirmLabel={t("account.delete.confirm")}
        tone="danger"
        pending={pending}
        onConfirm={() => void confirm()}
        onClose={() => setOpen(false)}
      />
    </Card>
  );
}
