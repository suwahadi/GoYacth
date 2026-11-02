package scenarios

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"strings"
	"testing"
	"time"

	"goyacht/internal/modules/cms"
	"goyacht/internal/modules/seed"
	"goyacht/internal/testutil"
)

func fakePhotos(t *testing.T) seed.PhotoSource {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 64, 40))
	img.Set(1, 1, color.White)
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return func(context.Context, string) ([]byte, error) { return buf.Bytes(), nil }
}

func TestDemoSeedRefusedInProduction(t *testing.T) {
	env := testutil.NewEnv(t)
	cfg := testutil.Config()
	cfg.Env = "production"
	seeded, err := seed.Demo(context.Background(), cfg, env.Pool, env.Store, fakePhotos(t))
	if seeded || !errors.Is(err, seed.ErrDemoInProduction) {
		t.Fatalf("seeded=%v err=%v", seeded, err)
	}
	var boats, admins int
	if err := env.Pool.QueryRow(context.Background(), `SELECT (SELECT count(*) FROM boats), (SELECT count(*) FROM users WHERE role = 'ADMIN')`).Scan(&boats, &admins); err != nil {
		t.Fatal(err)
	}
	if boats != 0 || admins != 0 {
		t.Fatalf("production database received %d boats and %d admins with a published password", boats, admins)
	}
}

func TestDemoSeedServesTheWholeSite(t *testing.T) {
	env := testutil.NewEnv(t)
	ctx := context.Background()
	seeded, err := seed.Demo(ctx, testutil.Config(), env.Pool, env.Store, fakePhotos(t))
	if err != nil {
		t.Fatal(err)
	}
	if !seeded {
		t.Fatal("first run must seed")
	}
	api := env.Anonymous()

	count := func(path string) int {
		t.Helper()
		res := api.Get(t, path)
		if res.Status != http.StatusOK {
			t.Fatalf("%s: %d %s", path, res.Status, res.Body)
		}
		var items []map[string]any
		res.Data(t, &items)
		return len(items)
	}

	var boats []struct {
		ID        string `json:"id"`
		Slug      string `json:"slug"`
		FromPrice int64  `json:"from_price"`
		Thumbnail *struct {
			Sources []struct {
				URL string `json:"url"`
			} `json:"sources"`
		} `json:"thumbnail"`
	}
	res := api.Get(t, "/api/v1/boats?per_page=48&locale=id")
	res.Data(t, &boats)
	if len(boats) != 30 {
		t.Fatalf("boats = %d, want 30", len(boats))
	}
	prices := map[int64]bool{}
	for _, b := range boats {
		prices[b.FromPrice] = true
		if b.FromPrice == 0 || b.Thumbnail == nil || len(b.Thumbnail.Sources) == 0 {
			t.Fatalf("boat %s has no price or photo", b.Slug)
		}
		if !strings.HasSuffix(b.Thumbnail.Sources[0].URL, ".webp") {
			t.Fatalf("boat %s photo is not WebP: %s", b.Slug, b.Thumbnail.Sources[0].URL)
		}
	}
	if len(prices) < 20 {
		t.Fatalf("only %d distinct prices", len(prices))
	}
	if n := count("/api/v1/routes"); n < 6 {
		t.Fatalf("routes = %d, want at least 6", n)
	}
	if n := count("/api/v1/regions"); n != 4 {
		t.Fatalf("regions = %d", n)
	}
	if n := count("/api/v1/packages"); n < 4 {
		t.Fatalf("packages = %d", n)
	}
	if n := count("/api/v1/departures"); n < 10 {
		t.Fatalf("departures = %d", n)
	}
	if n := count("/api/v1/faqs"); n < 10 {
		t.Fatalf("faqs = %d", n)
	}
	for _, slug := range []string{"about", "contact", "how-to-book", "terms", "privacy", "cancellation-policy"} {
		if cms.IsReservedSlug(slug) {
			t.Fatalf("demo page %s can never be reached at the site root", slug)
		}
		for _, locale := range []string{"en", "id"} {
			if r := api.Get(t, "/api/v1/pages/"+slug+"?locale="+locale); r.Status != http.StatusOK {
				t.Fatalf("page %s (%s): %d", slug, locale, r.Status)
			}
		}
	}

	var sections []struct {
		Type  string `json:"type"`
		Data  []any  `json:"data"`
		Image *struct {
			Sources []any `json:"sources"`
		} `json:"image"`
	}
	api.Get(t, "/api/v1/home?locale=en").Data(t, &sections)
	got := map[string]int{}
	for _, s := range sections {
		got[s.Type]++
		switch s.Type {
		case "HERO":
			if s.Image == nil || len(s.Image.Sources) == 0 {
				t.Fatal("hero slide has no image")
			}
		case "REVIEWS":
			if len(s.Data) != 8 {
				t.Fatalf("testimonials = %d, want 8", len(s.Data))
			}
		case "FEATURED_BOATS":
			if len(s.Data) != 3 {
				t.Fatalf("featured boats = %d", len(s.Data))
			}
		}
	}
	if got["HERO"] != 3 || got["HIGHLIGHTS"] != 2 || got["REGIONS"] != 1 || got["CTA"] != 1 {
		t.Fatalf("homepage sections: %v", got)
	}

	assertQuote := func(boatSlug, rateUnit, routeSlug string, units int) {
		t.Helper()
		var detail struct {
			ID string `json:"id"`
		}
		api.Get(t, "/api/v1/boats/"+boatSlug).Data(t, &detail)
		var routes []struct {
			ID   string `json:"id"`
			Slug string `json:"slug"`
		}
		api.Get(t, "/api/v1/routes").Data(t, &routes)
		routeID := ""
		for _, r := range routes {
			if r.Slug == routeSlug {
				routeID = r.ID
			}
		}
		date := time.Now().AddDate(0, 0, 45).Format(time.DateOnly)
		q := api.Post(t, "/api/v1/quotes", map[string]any{"product": map[string]any{"mode": "PRIVATE_CHARTER", "boat_id": detail.ID, "route_id": routeID,
			"date": date, "start_time": "08:00", "rate_unit": rateUnit, "units": units}, "pax": 2})
		if q.Status != http.StatusOK {
			t.Fatalf("quote %s %s: %d %s", boatSlug, rateUnit, q.Status, q.Body)
		}
	}
	assertQuote("azure-serenity", "HOURLY", "nusa-penida-day-trip", 8)
	assertQuote("komodo-dream", "DAILY", "komodo-highlights", 2)
	assertQuote("coral-dash", "FIXED", "benoa-sunset-cruise", 1)

	seeded, err = seed.Demo(ctx, testutil.Config(), env.Pool, env.Store, fakePhotos(t))
	if err != nil || seeded {
		t.Fatalf("second run: seeded=%v err=%v", seeded, err)
	}
	if n := count("/api/v1/regions"); n != 4 {
		t.Fatalf("second run duplicated regions: %d", n)
	}
}
