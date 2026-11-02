package scenarios

import (
	"context"
	"net/http"
	"testing"

	"goyacht/internal/modules/auth"
	"goyacht/internal/testutil"
)

func pageBody(slug, title string) map[string]any {
	return map[string]any{
		"status":       "PUBLISHED",
		"translations": map[string]any{"en": map[string]any{"title": title, "slug": slug, "blocks": []any{}}},
	}
}

func slugError(t *testing.T, r testutil.Response) string {
	t.Helper()
	var env struct {
		Error struct {
			Fields map[string]string `json:"fields"`
		} `json:"error"`
	}
	r.JSON(t, &env)
	return env.Error.Fields["translations.en.slug"]
}

func countPages(t *testing.T, env *testutil.Env) int {
	t.Helper()
	var n int
	if err := env.Pool.QueryRow(context.Background(), `SELECT count(*) FROM pages`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestPageSlugCannotTakeARouteOrLocale(t *testing.T) {
	env := testutil.NewEnv(t)
	admin, _ := env.Login(t, "boss@example.com", auth.RoleAdmin)
	for _, slug := range []string{"boats", "faq", "login", "admin", "api", "media", "id", "en"} {
		r := admin.Post(t, "/api/v1/admin/pages", pageBody(slug, "Page"))
		if r.Status != http.StatusUnprocessableEntity || slugError(t, r) != "SLUG_TAKEN" {
			t.Fatalf("%s: %d %s", slug, r.Status, r.Body)
		}
	}
	if n := countPages(t, env); n != 0 {
		t.Fatalf("refused saves left %d pages behind", n)
	}
}

func TestPageTitleNamedAfterARouteGetsAFreeSlug(t *testing.T) {
	env := testutil.NewEnv(t)
	admin, _ := env.Login(t, "boss@example.com", auth.RoleAdmin)
	if r := admin.Post(t, "/api/v1/admin/pages", pageBody("", "Boats")); r.Status != http.StatusOK {
		t.Fatalf("save: %d %s", r.Status, r.Body)
	}
	api := env.Anonymous()
	if r := api.Get(t, "/api/v1/pages/boats-2?locale=en"); r.Status != http.StatusOK {
		t.Fatalf("boats-2: %d", r.Status)
	}
	if r := api.Get(t, "/api/v1/pages/boats?locale=en"); r.Status != http.StatusNotFound {
		t.Fatalf("boats: %d", r.Status)
	}
}

func TestPageSlugCannotBeDuplicated(t *testing.T) {
	env := testutil.NewEnv(t)
	admin, _ := env.Login(t, "boss@example.com", auth.RoleAdmin)
	first := admin.Post(t, "/api/v1/admin/pages", pageBody("about", "About"))
	if first.Status != http.StatusOK {
		t.Fatalf("first: %d %s", first.Status, first.Body)
	}
	var created struct {
		ID string `json:"id"`
	}
	first.Data(t, &created)

	r := admin.Post(t, "/api/v1/admin/pages", pageBody("about", "Another About"))
	if r.Status != http.StatusUnprocessableEntity || slugError(t, r) != "SLUG_TAKEN" {
		t.Fatalf("duplicate: %d %s", r.Status, r.Body)
	}
	if n := countPages(t, env); n != 1 {
		t.Fatalf("pages = %d, the refused save must not leave a second page", n)
	}
	if r := admin.Do(t, http.MethodPut, "/api/v1/admin/pages/"+created.ID, pageBody("about", "About us"), nil); r.Status != http.StatusOK {
		t.Fatalf("a page keeps its own slug: %d %s", r.Status, r.Body)
	}
}
