package app

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/riverqueue/river"

	"goyacht/internal/integrations/midtrans"
	"goyacht/internal/integrations/smtp"
	"goyacht/internal/integrations/turnstile"
	"goyacht/internal/modules/bookingadmin"
	"goyacht/internal/modules/bookings"
	"goyacht/internal/modules/catalog"
	"goyacht/internal/modules/cms"
	"goyacht/internal/modules/departures"
	"goyacht/internal/modules/media"
	"goyacht/internal/modules/notifications"
	"goyacht/internal/modules/packages"
	"goyacht/internal/modules/payments"
	"goyacht/internal/modules/pricing"
	"goyacht/internal/modules/refunds"
	"goyacht/internal/modules/reports"
	"goyacht/internal/modules/reviews"
	"goyacht/internal/modules/scheduler"
	"goyacht/internal/modules/settings"
	"goyacht/internal/modules/settlements"
	"goyacht/internal/modules/tickets"
	"goyacht/internal/modules/users"
	"goyacht/internal/platform/db/dbq"
	"goyacht/internal/platform/jobs"
)

// Services are shared between the API and the worker so both apply identical business rules.
type Services struct {
	Media         *media.Service
	Bookings      *bookings.Service
	Payments      *payments.Service
	Refunds       *refunds.Service
	Notifications *notifications.Service
	Scheduler     *scheduler.Service
	Gateway       midtrans.Gateway
}

func NewServices(d *Deps, gw midtrans.Gateway, sender smtp.Sender) *Services {
	cfg := d.Config
	if gw == nil {
		gw = midtrans.New(cfg.MidtransServerKey, cfg.MidtransClientKey, cfg.MidtransSnapURL, cfg.MidtransAPIURL, cfg.MidtransProduction)
	}
	if sender == nil {
		sender = smtp.New(smtp.Config{Host: cfg.SMTPHost, Port: cfg.SMTPPort, Username: cfg.SMTPUsername, Password: cfg.SMTPPassword,
			TLSMode: cfg.SMTPTLSMode, FromAddress: cfg.MailFromAddress, FromName: cfg.MailFromName})
	}
	enq := d.Enqueuer()
	rf := refunds.NewService(d.Pool, gw, enq)
	return &Services{
		Media:         media.NewService(d.Pool, d.Store, enq),
		Bookings:      bookings.NewService(d.Pool, d.Cipher, enq),
		Payments:      payments.NewService(d.Pool, gw, enq, cfg.AppURL.String(), cfg.MidtransMerchantID),
		Refunds:       rf,
		Notifications: notifications.NewService(d.Pool, sender, d.Messages, cfg.AppURL.String(), cfg.AdminNotifyTo),
		Scheduler:     scheduler.New(d.Pool, rf, enq),
		Gateway:       gw,
	}
}

func registerFeatureModules(d *Deps, m *Modules, s *Services) {
	cfg := d.Config
	usersH := users.NewHandler(d.Pool)
	settingsH := settings.NewHandler(d.Pool)
	masterH := catalog.NewMasterHandler(d.Pool)
	locationH := catalog.NewLocationHandler(d.Pool, s.Media, d.Store)
	boatH := catalog.NewBoatHandler(d.Pool, s.Media, d.Store)
	packagesH := packages.NewHandler(d.Pool, s.Media, d.Store)
	reviewsH := reviews.NewHandler(d.Pool, s.Media, d.Store)
	cmsH := cms.NewHandler(d.Pool, s.Media, d.Store, cms.HomeExtras{
		PackageCards: func(ctx context.Context, q *dbq.Queries, loc string, ids []uuid.UUID) (any, error) {
			return packages.Cards(ctx, q, d.Store, loc, ids, 12)
		},
		FeaturedRevs: func(ctx context.Context, q *dbq.Queries, loc string, limit int32) (any, error) {
			return reviews.List(ctx, q, d.Store, loc, nil, true, limit, 0)
		},
	})
	pricingH := pricing.NewHandler(d.Pool)
	departuresH := departures.NewHandler(d.Pool, s.Refunds.Cancel)
	bookingsH := bookings.NewHandler(s.Bookings)
	paymentsH := payments.NewHandler(s.Payments)
	ts := turnstile.New(cfg.TurnstileSecret)
	opsH := bookingadmin.NewHandler(d.Pool, s.Bookings, s.Refunds, d.Cipher, d.Enqueuer(), ts.Verify)
	ticketsH := tickets.NewHandler(d.Pool, d.Messages, d.Cipher, cfg.AppURL.String())
	settlementsH := settlements.NewHandler(d.Pool)
	reportsH := reports.NewHandler(d.Pool)

	m.Public = append(m.Public, settingsH.PublicRoutes, masterH.PublicRoutes, locationH.PublicRoutes, boatH.PublicRoutes, cmsH.PublicRoutes,
		packagesH.PublicRoutes, reviewsH.PublicRoutes, pricingH.PublicRoutes, departuresH.PublicRoutes, bookingsH.PublicRoutes, paymentsH.PublicRoutes, opsH.PublicRoutes)
	m.Customer = append(m.Customer, usersH.CustomerRoutes, bookingsH.CustomerRoutes, paymentsH.CustomerRoutes, opsH.CustomerRoutes, ticketsH.CustomerRoutes, reviewsH.CustomerRoutes)
	m.Admin = append(m.Admin, usersH.AdminRoutes, settingsH.AdminRoutes, masterH.AdminRoutes, locationH.AdminRoutes, boatH.AdminRoutes, cmsH.AdminRoutes,
		packagesH.AdminRoutes, reviewsH.AdminRoutes, pricingH.AdminRoutes, departuresH.AdminRoutes, paymentsH.AdminRoutes, opsH.AdminRoutes,
		ticketsH.AdminRoutes, settlementsH.AdminRoutes, reportsH.AdminRoutes)
	m.Webhooks = append(m.Webhooks, paymentsH.WebhookRoutes)
}

type fnWorker[T river.JobArgs] struct {
	river.WorkerDefaults[T]
	fn func(ctx context.Context, args T) error
}

func (w *fnWorker[T]) Work(ctx context.Context, job *river.Job[T]) error { return w.fn(ctx, job.Args) }

func add[T river.JobArgs](workers *river.Workers, fn func(ctx context.Context, args T) error) {
	river.AddWorker(workers, &fnWorker[T]{fn: fn})
}

func registerFeatureWorkers(d *Deps, workers *river.Workers, s *Services) []*river.PeriodicJob {
	add(workers, func(ctx context.Context, a jobs.Notify) error { return s.Notifications.Send(ctx, a) })
	add(workers, func(ctx context.Context, a jobs.SendWelcome) error { return s.Notifications.SendWelcome(ctx, a.UserID) })
	add(workers, func(ctx context.Context, a jobs.SendAuthEmail) error { return s.Notifications.SendAuthEmail(ctx, a) })
	add(workers, func(ctx context.Context, a jobs.RefundProvider) error {
		return s.Refunds.ProcessProvider(ctx, a.RefundID)
	})
	add(workers, func(ctx context.Context, _ jobs.ExpireHolds) error { return s.Scheduler.ExpireHolds(ctx) })
	add(workers, func(ctx context.Context, _ jobs.AdvanceBookings) error { return s.Scheduler.AdvanceBookings(ctx) })
	add(workers, func(ctx context.Context, _ jobs.CancelOverdueBalances) error {
		return s.Scheduler.CancelOverdueBalances(ctx)
	})
	add(workers, func(ctx context.Context, _ jobs.BalanceReminders) error { return s.Scheduler.BalanceReminders(ctx) })
	add(workers, func(ctx context.Context, _ jobs.ReconcilePayments) error { return s.Payments.Reconcile(ctx) })
	add(workers, func(ctx context.Context, _ jobs.TripReminders) error { return s.Scheduler.TripReminders(ctx) })
	add(workers, func(ctx context.Context, _ jobs.PurgeIdentities) error { return s.Scheduler.PurgeIdentities(ctx) })
	return []*river.PeriodicJob{
		periodic(time.Minute, jobs.ExpireHolds{}),
		periodic(5*time.Minute, jobs.AdvanceBookings{}),
		periodic(5*time.Minute, jobs.CancelOverdueBalances{}),
		periodic(time.Hour, jobs.BalanceReminders{}),
		periodic(15*time.Minute, jobs.ReconcilePayments{}),
		periodic(time.Hour, jobs.TripReminders{}),
		periodic(24*time.Hour, jobs.PurgeIdentities{}),
	}
}
