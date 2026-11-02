package cms

import (
	"os"
	"regexp"
	"strings"
	"testing"
)

// A new route in routes.ts that is not reserved could be shadowed by a page, or shadow one.
func TestReservedSlugsCoverRoutes(t *testing.T) {
	raw, err := os.ReadFile("../../../../frontend/app/routes.ts")
	if err != nil {
		t.Fatal(err)
	}
	src := string(raw)
	start, end := strings.Index(src, "function localized("), strings.Index(src, "const tree =")
	if start < 0 || end < start {
		t.Fatal("routes.ts no longer has the expected layout")
	}
	// Indentation tells first segments from nested ones: the file has a fixed Prettier layout.
	found := regexp.MustCompile(`(?m)^ {4}route\("([a-z0-9-]+)["/]`).FindAllStringSubmatch(src[start:end], -1)
	found = append(found, regexp.MustCompile(`(?m)^ {2}route\("([a-z0-9-]+)["/]`).FindAllStringSubmatch(src[end:], -1)...)
	if len(found) < 10 {
		t.Fatalf("parsed only %d routes from routes.ts", len(found))
	}
	for _, m := range found {
		if !IsReservedSlug(m[1]) {
			t.Errorf("route %q is not in reservedSlugs", m[1])
		}
	}
}
