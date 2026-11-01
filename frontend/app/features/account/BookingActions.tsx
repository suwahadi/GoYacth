import { useRef, useState } from "react";
import { useNavigate, useRevalidator } from "react-router";

import { ApiErrorMessage, Button, ButtonPair, Card, ConfirmDialog, Dialog, Field, Money, Textarea, buttonClass, useFieldErrors, useToast } from "~/components/ui";
import { nextIdempotencyKey, type KeyedContent } from "~/features/booking/idempotency";
import { PaymentMethodPicker } from "~/features/booking/PaymentMethodPicker";
import { createPayment, openPayment } from "~/features/booking/snap";
import { api, newIdempotencyKey } from "~/lib/api";
import { localePath } from "~/lib/config";
import { useLocale, useT } from "~/lib/i18n";
import type { Booking, PaymentMethodOption } from "~/lib/types";

export function BookingActions({ booking, methods }: { booking: Booking; methods: PaymentMethodOption[] | null }) {
  const t = useT();
  const locale = useLocale();
  const a = booking.actions;
  const [dialog, setDialog] = useState<null | "pay" | "cancel_unpaid" | "CANCEL" | "RESCHEDULE">(null);
  const close = () => setDialog(null);
  const hasAny = a.can_pay || a.can_cancel_unpaid || a.can_request_cancel || a.can_request_reschedule || a.can_download_ticket;
  if (!hasAny) return null;
  const pdf = (doc: "ticket" | "invoice") => `/api/v1/bookings/${booking.id}/${doc}.pdf?locale=${locale}`;
  return (
    <Card>
      <h2 className="text-lg font-semibold">{t("account.actions.title")}</h2>
      <div className="mt-3 space-y-3">
        {a.can_pay && (
          <Button full onClick={() => setDialog("pay")}>
            {booking.status === "PENDING_PAYMENT" ? t("account.actions.pay_now") : t("account.actions.pay_balance")}
          </Button>
        )}
        {a.can_download_ticket && (
          <ButtonPair>
            <a href={pdf("ticket")} className={buttonClass("secondary", "md", true)} download>
              {t("account.actions.ticket")}
            </a>
            <a href={pdf("invoice")} className={buttonClass("secondary", "md", true)} download>
              {t("account.actions.invoice")}
            </a>
          </ButtonPair>
        )}
        {a.can_request_cancel && a.can_request_reschedule ? (
          <ButtonPair>
            <Button variant="secondary" onClick={() => setDialog("RESCHEDULE")}>
              {t("account.actions.request_reschedule")}
            </Button>
            <Button variant="secondary" onClick={() => setDialog("CANCEL")}>
              {t("account.actions.request_cancel")}
            </Button>
          </ButtonPair>
        ) : (
          <>
            {a.can_request_reschedule && (
              <Button variant="secondary" full onClick={() => setDialog("RESCHEDULE")}>
                {t("account.actions.request_reschedule")}
              </Button>
            )}
            {a.can_request_cancel && (
              <Button variant="secondary" full onClick={() => setDialog("CANCEL")}>
                {t("account.actions.request_cancel")}
              </Button>
            )}
          </>
        )}
        {a.can_cancel_unpaid && (
          <Button variant="ghost" full onClick={() => setDialog("cancel_unpaid")}>
            {t("account.actions.cancel_unpaid")}
          </Button>
        )}
      </div>
      {a.can_pay && <PayDialog open={dialog === "pay"} onClose={close} booking={booking} methods={methods} />}
      {a.can_cancel_unpaid && <CancelUnpaidDialog open={dialog === "cancel_unpaid"} onClose={close} bookingId={booking.id} />}
      {(dialog === "CANCEL" || dialog === "RESCHEDULE") && <RequestDialog kind={dialog} onClose={close} bookingId={booking.id} />}
    </Card>
  );
}

function PayDialog({ open, onClose, booking, methods }: { open: boolean; onClose: () => void; booking: Booking; methods: PaymentMethodOption[] | null }) {
  const t = useT();
  const locale = useLocale();
  const navigate = useNavigate();
  const [method, setMethod] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [missing, setMissing] = useState(false);
  const key = useRef<KeyedContent | null>(null);
  const depositDue = booking.status === "PENDING_PAYMENT" && booking.payment_scheme === "DEPOSIT";

  async function pay() {
    if (!method) {
      setMissing(true);
      return;
    }
    setMissing(false);
    setPending(true);
    setError(null);
    try {
      key.current = nextIdempotencyKey(key.current, `${booking.id}:${method}`, newIdempotencyKey);
      const payment = await createPayment(booking.id, method, key.current.key);
      onClose();
      await openPayment(payment, () => navigate(localePath(locale, `/orders/${booking.id}/status`)));
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("account.pay.title")}
      footer={
        <ButtonPair>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            {t("common.actions.cancel")}
          </Button>
          <Button onClick={() => void pay()} pending={pending} disabled={!methods || methods.length === 0}>
            {t("account.pay.continue")}
          </Button>
        </ButtonPair>
      }
    >
      <div className="space-y-4">
        <p className="flex justify-between gap-3 text-sm font-medium">
          <span>{depositDue ? t("account.pay.deposit_due") : t("account.pay.amount_due")}</span>
          <Money amount={depositDue ? booking.deposit_amount : booking.balance_due} />
        </p>
        <p className="text-xs text-muted">{t("account.pay.fee_note")}</p>
        {methods ? (
          <PaymentMethodPicker methods={methods} value={method} onChange={setMethod} disabled={pending} error={missing ? t("booking.payment.choose_method") : undefined} />
        ) : (
          <p className="text-sm text-danger">{t("booking.checkout.methods_failed")}</p>
        )}
        <ApiErrorMessage error={error} />
      </div>
    </Dialog>
  );
}

function CancelUnpaidDialog({ open, onClose, bookingId }: { open: boolean; onClose: () => void; bookingId: string }) {
  const t = useT();
  const toast = useToast();
  const revalidator = useRevalidator();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function confirm() {
    setPending(true);
    setError(null);
    try {
      await api(`/bookings/${bookingId}/cancel-unpaid`, { method: "POST" });
      toast(t("account.cancel_unpaid.done"));
      onClose();
      revalidator.revalidate();
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  }

  return (
    <ConfirmDialog
      open={open}
      title={t("account.cancel_unpaid.title")}
      body={
        <>
          <p>{t("account.cancel_unpaid.body")}</p>
          <ApiErrorMessage error={error} className="mt-3" />
        </>
      }
      confirmLabel={t("account.cancel_unpaid.confirm")}
      tone="danger"
      pending={pending}
      onConfirm={() => void confirm()}
      onClose={onClose}
    />
  );
}

function RequestDialog({ kind, onClose, bookingId }: { kind: "CANCEL" | "RESCHEDULE"; onClose: () => void; bookingId: string }) {
  const t = useT();
  const toast = useToast();
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const fe = useFieldErrors(error);
  const cancel = kind === "CANCEL";

  async function submit() {
    setPending(true);
    setError(null);
    try {
      await api(`/bookings/${bookingId}/${cancel ? "cancel-request" : "reschedule-request"}`, { method: "POST", body: { message: message.trim() } });
      toast(t("account.request.sent"));
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={cancel ? t("account.request.cancel_title") : t("account.request.reschedule_title")}
      footer={
        <ButtonPair>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            {t("common.actions.cancel")}
          </Button>
          <Button onClick={() => void submit()} pending={pending}>
            {t("account.request.send")}
          </Button>
        </ButtonPair>
      }
    >
      <div className="space-y-3">
        <p className="text-sm">{cancel ? t("account.request.cancel_body") : t("account.request.reschedule_body")}</p>
        <Field label={t("account.request.message")} error={fe["message"]} hint={cancel ? undefined : t("account.request.reschedule_hint")}>
          {(p) => <Textarea {...p} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000} />}
        </Field>
        <ApiErrorMessage error={error} />
      </div>
    </Dialog>
  );
}
