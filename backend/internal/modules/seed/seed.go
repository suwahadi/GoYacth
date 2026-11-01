// Package seed inserts reference master data that the system needs before an admin can work:
// payment method rows, a default payment and cancellation policy, and default settings. It never
// overwrites existing rows and never inserts catalog, booking or customer data.
package seed

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"goyacht/internal/platform/db"
)

func Reference(ctx context.Context, pool *pgxpool.Pool) error {
	return db.InTx(ctx, pool, func(tx pgx.Tx) error {
		stmts := []string{
			`INSERT INTO payment_method_fees (method, fee_type, fee_value, hold_minutes, enabled, sort_order) VALUES
				('CREDIT_CARD', 'FIXED', 0, 15, true, 1),
				('QRIS',        'FIXED', 0, 15, true, 2),
				('BCA_VA',      'FIXED', 0, 60, true, 3),
				('BNI_VA',      'FIXED', 0, 60, true, 4),
				('BRI_VA',      'FIXED', 0, 60, true, 5),
				('MANDIRI_VA',  'FIXED', 0, 60, true, 6),
				('PERMATA_VA',  'FIXED', 0, 60, true, 7)
			ON CONFLICT (method) DO NOTHING`,
			`INSERT INTO payment_policies (name, type)
			SELECT 'Full payment', 'FULL' WHERE NOT EXISTS (SELECT 1 FROM payment_policies)`,
			`WITH p AS (
				INSERT INTO cancellation_policies (name)
				SELECT 'Standard' WHERE NOT EXISTS (SELECT 1 FROM cancellation_policies)
				RETURNING id
			)
			INSERT INTO cancellation_policy_tiers (policy_id, min_days_before, refund_basis_points)
			SELECT id, d, bp FROM p, (VALUES (8, 10000), (3, 5000), (0, 0)) AS t(d, bp)`,
			`INSERT INTO settings (key, value) VALUES
				('site', '{"name":"GoYacht","email":"","phone":"","whatsapp":"","address":""}'),
				('seo', '{"default_title":"GoYacht","default_description":"","og_image_media_id":null}'),
				('analytics', '{"ga4_id":"","gtm_id":""}'),
				('booking', '{"min_lead_hours":24,"max_advance_days":365,"admin_hold_minutes":1440,"balance_reminder_days":[3,1],"identity_retention_days":90}'),
				('currency', '{"usd_rate_idr":0}'),
				('legal', '{"terms_version":"","privacy_version":"","cancellation_version":""}')
			ON CONFLICT (key) DO NOTHING`,
		}
		for _, s := range stmts {
			if _, err := tx.Exec(ctx, s); err != nil {
				return err
			}
		}
		return nil
	})
}
