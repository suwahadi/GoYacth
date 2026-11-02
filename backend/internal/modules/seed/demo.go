package seed

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"goyacht/internal/integrations/storage"
	"goyacht/internal/modules/auth"
	"goyacht/internal/modules/catalog"
	"goyacht/internal/modules/cms"
	"goyacht/internal/modules/media"
	"goyacht/internal/modules/packages"
	"goyacht/internal/platform/config"
	"goyacht/internal/platform/db"
)

// ErrDemoInProduction stops invented boats, prices and reviews from reaching customers.
var ErrDemoInProduction = errors.New("demo data is refused when APP_ENV=production")

// Known credentials are acceptable only because Demo refuses to run in production.
const (
	DemoAdminEmail    = "admin@goyacht.example"
	DemoAdminPassword = "GoYacht-Demo-2026"
)

// PhotoSource returns the bytes of one photo. Tests pass a fake so they stay offline.
type PhotoSource func(ctx context.Context, photoID string) ([]byte, error)

// UnsplashPhotos reads from the Unsplash image CDN. Every demoPhotos ID belongs to the free
// library (images.unsplash.com), never to the paid Unsplash+ collection.
func UnsplashPhotos(client *http.Client) PhotoSource {
	return func(ctx context.Context, photoID string) ([]byte, error) {
		url := fmt.Sprintf("https://images.unsplash.com/photo-%s?w=1600&q=82&fm=jpg&fit=max", photoID)
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if err != nil {
			return nil, err
		}
		res, err := client.Do(req)
		if err != nil {
			return nil, err
		}
		defer func() { _ = res.Body.Close() }()
		if res.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("unsplash photo %s answered %d", photoID, res.StatusCode)
		}
		return io.ReadAll(io.LimitReader(res.Body, media.MaxUploadBytes))
	}
}

type text struct{ en, id string }

func (t text) get(locale string) string {
	if locale == "id" {
		return t.id
	}
	return t.en
}

var demoLocales = []string{"en", "id"}

// seeder keeps the first error, so the long insert sequence reads as data instead of error checks.
type seeder struct {
	ctx    context.Context
	tx     pgx.Tx
	media  *media.Service
	photos map[string]uuid.UUID
	now    time.Time
	err    error

	categories, classes, facilities map[string]uuid.UUID
	regions, ports, routes          map[string]uuid.UUID
	partners                        map[string]uuid.UUID
	boats                           map[string]seededBoat
	fullPayment, depositPayment     uuid.UUID
	cancellation                    uuid.UUID
}

type seededBoat struct {
	id    uuid.UUID
	areas []uuid.UUID
}

func (s *seeder) fail(sql string, err error) {
	statement := strings.Join(strings.Fields(sql), " ")
	s.err = fmt.Errorf("%s: %w", statement[:min(70, len(statement))], err)
}

func (s *seeder) exec(sql string, args ...any) {
	if s.err != nil {
		return
	}
	if _, err := s.tx.Exec(s.ctx, sql, args...); err != nil {
		s.fail(sql, err)
	}
}

func (s *seeder) insert(sql string, args ...any) uuid.UUID {
	var id uuid.UUID
	if s.err != nil {
		return id
	}
	if err := s.tx.QueryRow(s.ctx, sql, args...).Scan(&id); err != nil {
		s.fail(sql, err)
	}
	return id
}

func (s *seeder) attach(entity string, id uuid.UUID, role string, photoKeys ...string) {
	if s.err != nil {
		return
	}
	ids := make([]uuid.UUID, 0, len(photoKeys))
	for _, k := range photoKeys {
		mediaID, ok := s.photos[k]
		if !ok {
			s.err = fmt.Errorf("unknown demo photo %q", k)
			return
		}
		ids = append(ids, mediaID)
	}
	s.err = s.media.SetUsages(s.ctx, s.tx, entity, id, role, ids)
}

func mustJSON(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return string(b)
}

// Demo fills an empty development database with a complete browsable catalog. It reports false
// when demo data already exists, so running it twice changes nothing.
func Demo(ctx context.Context, cfg *config.Config, pool *pgxpool.Pool, store storage.Store, photos PhotoSource) (bool, error) {
	if cfg.IsProduction() {
		return false, ErrDemoInProduction
	}
	if err := auth.CreateAdmin(ctx, pool, DemoAdminEmail, "Demo Admin", DemoAdminPassword, nil); err != nil && !errors.Is(err, auth.ErrAdminExists) {
		return false, err
	}
	var exists bool
	if err := pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM boats WHERE code = 'DEMO-01')`).Scan(&exists); err != nil {
		return false, err
	}
	if exists {
		return false, nil
	}
	if err := Reference(ctx, pool); err != nil {
		return false, err
	}
	svc := media.NewService(pool, store, nil)
	ids := make(map[string]uuid.UUID, len(demoPhotos))
	for i, p := range demoPhotos {
		raw, err := photos(ctx, p.id)
		if err != nil {
			return false, fmt.Errorf("photo %s: %w", p.key, err)
		}
		id, err := svc.Import(ctx, raw, p.key, map[string]string{"en": p.alt.en, "id": p.alt.id})
		if err != nil {
			return false, fmt.Errorf("photo %s: %w", p.key, err)
		}
		ids[p.key] = id
		slog.InfoContext(ctx, "demo photo imported", "done", i+1, "total", len(demoPhotos), "key", p.key)
	}
	err := db.InTx(ctx, pool, func(tx pgx.Tx) error {
		s := &seeder{ctx: ctx, tx: tx, media: svc, photos: ids, now: time.Now()}
		s.policies()
		s.masterData()
		s.locations()
		s.fleet()
		s.pricing()
		s.packageOffers()
		s.departures()
		s.pages()
		s.faqs()
		s.testimonials()
		s.homepage()
		s.settings()
		return s.err
	})
	return err == nil, err
}

func (s *seeder) policies() {
	if s.err == nil {
		s.err = s.tx.QueryRow(s.ctx, `SELECT id FROM payment_policies WHERE type = 'FULL' ORDER BY created_at LIMIT 1`).Scan(&s.fullPayment)
	}
	if s.err == nil {
		s.err = s.tx.QueryRow(s.ctx, `SELECT id FROM cancellation_policies ORDER BY created_at LIMIT 1`).Scan(&s.cancellation)
	}
	s.depositPayment = s.insert(`INSERT INTO payment_policies (name, type, deposit_type, deposit_value, balance_due_days)
		VALUES ('Deposit 30%, balance 14 days before departure', 'DEPOSIT', 'PERCENTAGE', 3000, 14) RETURNING id`)
	for _, l := range demoLocales {
		s.exec(`INSERT INTO cancellation_policy_translations (policy_id, locale, description) VALUES ($1, $2, $3)
			ON CONFLICT (policy_id, locale) DO UPDATE SET description = EXCLUDED.description`, s.cancellation, l,
			text{"Full refund 8 or more days before departure, 50% from 3 to 7 days, no refund within 3 days.",
				"Refund penuh 8 hari atau lebih sebelum keberangkatan, 50% untuk 3 sampai 7 hari, tanpa refund dalam 3 hari."}.get(l))
	}
}

func (s *seeder) masterData() {
	s.categories, s.classes, s.facilities = map[string]uuid.UUID{}, map[string]uuid.UUID{}, map[string]uuid.UUID{}
	s.partners = map[string]uuid.UUID{}
	for i, c := range demoCategories {
		id := s.insert(`INSERT INTO boat_categories (sort_order) VALUES ($1) RETURNING id`, i)
		s.categories[c.key] = id
		for _, l := range demoLocales {
			s.exec(`INSERT INTO boat_category_translations (category_id, locale, name, slug) VALUES ($1, $2, $3, $4)`, id, l, c.name.get(l), c.key)
		}
	}
	for i, c := range demoClasses {
		id := s.insert(`INSERT INTO boat_classes (sort_order) VALUES ($1) RETURNING id`, i)
		s.classes[c.key] = id
		for _, l := range demoLocales {
			s.exec(`INSERT INTO boat_class_translations (class_id, locale, name, slug) VALUES ($1, $2, $3, $4)`, id, l, c.name.get(l), c.key)
		}
	}
	for i, f := range demoFacilities {
		id := s.insert(`INSERT INTO facilities (icon, sort_order) VALUES ($1, $2) RETURNING id`, f.key, i)
		s.facilities[f.key] = id
		for _, l := range demoLocales {
			s.exec(`INSERT INTO facility_translations (facility_id, locale, name) VALUES ($1, $2, $3)`, id, l, f.name.get(l))
		}
	}
	for _, p := range demoPartners {
		s.partners[p.key] = s.insert(`INSERT INTO partners (name, contact_name, email, phone, bank_name, bank_account_name, bank_account_number, notes)
			VALUES ($1, $2, $3, $4, 'Demo Bank', $1, '0000000000', 'Demo partner') RETURNING id`, p.name, p.contact, p.email, p.phone)
	}
}

func (s *seeder) locations() {
	s.regions, s.ports, s.routes = map[string]uuid.UUID{}, map[string]uuid.UUID{}, map[string]uuid.UUID{}
	for i, r := range demoRegions {
		id := s.insert(`INSERT INTO regions (sort_order, status) VALUES ($1, 'PUBLISHED') RETURNING id`, i)
		s.regions[r.slug] = id
		for _, l := range demoLocales {
			s.exec(`INSERT INTO region_translations (region_id, locale, name, slug, description, seo_title, seo_description) VALUES ($1, $2, $3, $4, $5, $6, $5)`,
				id, l, r.name, r.slug, r.description.get(l), r.name+" "+text{"yacht charter", "sewa yacht"}.get(l))
		}
		s.attach(catalog.EntityRegion, id, catalog.RoleThumbnail, r.photos[0])
		s.attach(catalog.EntityRegion, id, catalog.RoleGallery, r.photos...)
	}
	for _, p := range demoPorts {
		id := s.insert(`INSERT INTO ports (region_id, address, latitude, longitude, timezone) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
			s.regions[p.region], p.address, p.lat, p.lng, p.timezone)
		s.ports[p.key] = id
		for _, l := range demoLocales {
			s.exec(`INSERT INTO port_translations (port_id, locale, name) VALUES ($1, $2, $3)`, id, l, p.name)
		}
	}
	for _, r := range demoRoutes {
		id := s.insert(`INSERT INTO routes (region_id, departure_port_id, return_port_id, duration_minutes, status) VALUES ($1, $2, $2, $3, 'PUBLISHED') RETURNING id`,
			s.regions[r.region], s.ports[r.port], r.minutes)
		s.routes[r.slug] = id
		for _, l := range demoLocales {
			s.exec(`INSERT INTO route_translations (route_id, locale, name, slug, description, seo_title, seo_description) VALUES ($1, $2, $3, $4, $5, $3, $5)`,
				id, l, r.name.get(l), r.slug, r.description.get(l))
		}
		for i, st := range r.stops {
			stop := s.insert(`INSERT INTO route_stops (route_id, sort_order, latitude, longitude) VALUES ($1, $2, $3, $4) RETURNING id`, id, i+1, st.lat, st.lng)
			for _, l := range demoLocales {
				s.exec(`INSERT INTO route_stop_translations (stop_id, locale, name, activity) VALUES ($1, $2, $3, $4)`, stop, l, st.name, st.activity.get(l))
			}
		}
		s.attach(catalog.EntityRoute, id, catalog.RoleThumbnail, r.photo)
		s.attach(catalog.EntityRoute, id, catalog.RoleGallery, r.photo)
	}
}

func (s *seeder) fleet() {
	s.boats = map[string]seededBoat{}
	for i, b := range demoBoats {
		code := fmt.Sprintf("DEMO-%02d", i+1)
		port := portOf(b.port)
		policy := s.depositPayment
		if b.category == "speedboat" {
			policy = s.fullPayment
		}
		var partner *uuid.UUID
		var commission *string
		var commissionValue int64
		ownership := "OWNED"
		if b.partner != "" {
			id, kind := s.partners[b.partner], "PERCENTAGE"
			partner, commission, commissionValue, ownership = &id, &kind, 1500, "PARTNER"
		}
		id := s.insert(`INSERT INTO boats (code, category_id, class_id, ownership, partner_id, commission_type, commission_value, home_port_id,
				max_passengers, length_cm, beam_cm, year_built, cabins, bathrooms, speed_knots, crew_count, turnaround_buffer_minutes,
				operating_start_minute, operating_end_minute, overnight_allowed, payment_policy_id, cancellation_policy_id, sort_order, status)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 60, 360, 1200, $17, $18, $19, $20, 'PUBLISHED') RETURNING id`,
			code, s.categories[b.category], s.classes[b.class], ownership, partner, commission, commissionValue, s.ports[b.port],
			b.pax, b.lengthCm, b.beamCm, b.year, b.cabins, b.baths, b.knots, b.crew, b.overnight(), policy, s.cancellation, i)
		for _, l := range demoLocales {
			summary, description := b.copy(l)
			s.exec(`INSERT INTO boat_translations (boat_id, locale, name, slug, summary, description, seo_title, seo_description) VALUES ($1, $2, $3, $4, $5, $6, $3, $5)`,
				id, l, b.name, slugOf(b.name), summary, description)
		}
		for _, r := range b.rates() {
			s.exec(`INSERT INTO boat_rates (boat_id, rate_unit, price, min_units, max_units) VALUES ($1, $2, $3, $4, $5)`, id, r.unit, r.price, r.minUnits, r.maxUnits)
		}
		s.exec(`INSERT INTO boat_regions (boat_id, region_id) VALUES ($1, $2)`, id, s.regions[port.region])
		for _, r := range demoRoutes {
			if r.region == port.region && (r.minutes <= 12*60 || b.daily > 0) {
				s.exec(`INSERT INTO boat_routes (boat_id, route_id) VALUES ($1, $2)`, id, s.routes[r.slug])
			}
		}
		for _, f := range facilitiesFor(b) {
			s.exec(`INSERT INTO boat_facilities (boat_id, facility_id) VALUES ($1, $2)`, id, s.facilities[f])
		}
		s.boats[b.name] = seededBoat{id: id, areas: s.areas(id, b)}
		s.attach(catalog.EntityBoat, id, catalog.RoleThumbnail, b.photos[0])
		s.attach(catalog.EntityBoat, id, catalog.RoleGallery, append(append([]string{}, b.photos...), interiorsFor(b)...)...)
	}
}

// Every boat keeps a system area so inventory always has a row to lock; it is sold only while the
// boat has no separately sold areas, which matches catalog.syncSystemArea.
func (s *seeder) areas(boat uuid.UUID, b demoBoat) []uuid.UUID {
	sold := b.soldAreas()
	status := "ACTIVE"
	if len(sold) > 0 {
		status = "INACTIVE"
	}
	system := s.insert(`INSERT INTO areas (boat_id, is_system, min_pax, max_pax, status) VALUES ($1, true, 1, $2, $3) RETURNING id`, boat, b.pax, status)
	for _, l := range demoLocales {
		s.exec(`INSERT INTO area_translations (area_id, locale, name) VALUES ($1, $2, $3)`, system, l, text{"Whole Boat", "Seluruh Kapal"}.get(l))
	}
	if len(sold) == 0 {
		return []uuid.UUID{system}
	}
	out := make([]uuid.UUID, 0, len(sold))
	for i, a := range sold {
		id := s.insert(`INSERT INTO areas (boat_id, deck_label, min_pax, max_pax, base_price, sort_order) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
			boat, a.deck, a.minPax, a.maxPax, a.price, i)
		for _, l := range demoLocales {
			s.exec(`INSERT INTO area_translations (area_id, locale, name, description) VALUES ($1, $2, $3, $4)`, id, l, a.name.get(l), a.description.get(l))
		}
		s.attach(catalog.EntityArea, id, catalog.RoleGallery, a.photo)
		out = append(out, id)
	}
	return out
}

func (s *seeder) pricing() {
	year := s.now.Year()
	peak := s.insert(`INSERT INTO seasons (name, kind, starts_on, ends_on) VALUES ('Year end peak', 'PEAK', $1, $2) RETURNING id`,
		time.Date(year, 12, 20, 0, 0, 0, 0, time.UTC), time.Date(year+1, 1, 5, 0, 0, 0, 0, time.UTC))
	high := s.insert(`INSERT INTO seasons (name, kind, starts_on, ends_on) VALUES ('Dry season high', 'HIGH', $1, $2) RETURNING id`,
		time.Date(year+1, 7, 1, 0, 0, 0, 0, time.UTC), time.Date(year+1, 8, 31, 0, 0, 0, 0, time.UTC))
	s.exec(`INSERT INTO price_overrides (boat_rate_id, rule_type, season_id, price)
		SELECT r.id, 'SEASON', $1, round(r.price * 1.25 / 100000) * 100000 FROM boat_rates r
		JOIN boats b ON b.id = r.boat_id JOIN boat_class_translations c ON c.class_id = b.class_id AND c.locale = 'en'
		WHERE b.code LIKE 'DEMO-%' AND c.slug IN ('vvip', 'vip') AND r.rate_unit = 'DAILY'`, peak)
	s.exec(`INSERT INTO price_overrides (boat_rate_id, rule_type, season_id, price)
		SELECT r.id, 'SEASON', $1, round(r.price * 1.1 / 100000) * 100000 FROM boat_rates r
		JOIN boats b ON b.id = r.boat_id WHERE b.code LIKE 'DEMO-%' AND r.rate_unit = 'DAILY'`, high)
	s.exec(`INSERT INTO price_overrides (boat_rate_id, rule_type, price)
		SELECT r.id, 'WEEKEND', round(r.price * 1.1 / 10000) * 10000 FROM boat_rates r
		JOIN boats b ON b.id = r.boat_id WHERE b.code LIKE 'DEMO-%' AND r.rate_unit = 'HOURLY'`)
	for i, t := range []struct {
		code     string
		bp       int
		previous bool
		name     text
	}{{"SERVICE", 500, false, text{"Service charge", "Biaya layanan"}}, {"VAT", 1100, true, text{"VAT", "PPN"}}} {
		id := s.insert(`INSERT INTO tax_lines (code, basis_points, includes_previous_lines, sort_order) VALUES ($1, $2, $3, $4)
			ON CONFLICT (code) DO UPDATE SET code = EXCLUDED.code RETURNING id`, t.code, t.bp, t.previous, i)
		for _, l := range demoLocales {
			s.exec(`INSERT INTO tax_line_translations (tax_line_id, locale, name) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, id, l, t.name.get(l))
		}
	}
	s.exec(`INSERT INTO promotions (name, code, discount_type, discount_value, min_subtotal, starts_at, ends_at, quota)
		VALUES ('Welcome 10%', 'WELCOME10', 'PERCENTAGE', 1000, 5000000, $1, $2, 100)`, s.now.AddDate(0, 0, -1), s.now.AddDate(1, 0, 0))
}

func (s *seeder) packageOffers() {
	for i, p := range demoPackages {
		id := s.insert(`INSERT INTO packages (mode, route_id, duration_minutes, min_pax, max_pax, valid_from, valid_until, booking_cutoff_hours,
				payment_policy_id, cancellation_policy_id, sort_order, status)
			VALUES ('PRIVATE_CHARTER', $1, $2, $3, $4, $5, $6, 48, $7, $8, $9, 'PUBLISHED') RETURNING id`,
			s.routes[p.route], p.minutes, p.minPax, p.maxPax, s.now.AddDate(0, 0, -1), s.now.AddDate(1, 0, 0), s.depositPayment, s.cancellation, i)
		for _, l := range demoLocales {
			s.exec(`INSERT INTO package_translations (package_id, locale, name, slug, summary, description, inclusions, exclusions, seo_title, seo_description)
				VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $3, $5)`, id, l, p.name.get(l), p.slug, p.summary.get(l), p.description.get(l),
				mustJSON(localized(p.inclusions, l)), mustJSON(localized(p.exclusions, l)))
		}
		s.exec(`INSERT INTO package_offerings (package_id, boat_id, price) VALUES ($1, $2, $3)`, id, s.boats[p.boat].id, p.price)
		s.attach(packages.EntityPackage, id, catalog.RoleThumbnail, p.photo)
		s.attach(packages.EntityPackage, id, catalog.RoleGallery, p.photo)
	}
}

func localized(items []text, locale string) []string {
	out := make([]string, 0, len(items))
	for _, t := range items {
		out = append(out, t.get(locale))
	}
	return out
}

func (s *seeder) pages() {
	for _, p := range demoPages() {
		id := s.insert(`INSERT INTO pages (status, published_at) VALUES ('PUBLISHED', $1) RETURNING id`, s.now)
		for _, l := range demoLocales {
			blocks := make([]cms.Block, 0, len(p.blocks))
			for _, b := range p.blocks {
				blocks = append(blocks, b.render(l))
			}
			s.exec(`INSERT INTO page_translations (page_id, locale, title, slug, blocks, seo_title, seo_description) VALUES ($1, $2, $3, $4, $5::jsonb, $3, $6)`,
				id, l, p.title.get(l), p.slug, mustJSON(blocks), p.description.get(l))
		}
		if p.photo != "" {
			s.attach(cms.EntityPage, id, "featured", p.photo)
		}
	}
}

func (s *seeder) faqs() {
	for i, f := range demoFaqs {
		id := s.insert(`INSERT INTO faqs (category, sort_order) VALUES ($1, $2) RETURNING id`, f.category, i)
		for _, l := range demoLocales {
			s.exec(`INSERT INTO faq_translations (faq_id, locale, question, answer) VALUES ($1, $2, $3, $4)`, id, l, f.question.get(l), f.answer.get(l))
		}
	}
}

func (s *seeder) settings() {
	values := map[string]any{
		"site":     map[string]string{"name": "GoYacht", "email": "hello@goyacht.example", "phone": "+62 361 555 0100", "whatsapp": "+62 812 0000 0000", "address": "Jl. Pelabuhan Benoa, Denpasar, Bali"},
		"seo":      map[string]any{"default_title": "GoYacht: yacht and boat charters in Indonesia", "default_description": "Private charters, shared departures and all-in packages across Bali, Lombok, Labuan Bajo and Raja Ampat.", "og_image_media_id": nil},
		"currency": map[string]int{"usd_rate_idr": 16000},
		"legal":    map[string]string{"terms_version": "demo-1", "privacy_version": "demo-1", "cancellation_version": "demo-1"},
	}
	for key, v := range values {
		s.exec(`INSERT INTO settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, key, mustJSON(v))
	}
}
