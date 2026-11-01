package app

import (
	"bufio"
	"net/http"
	"os"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"goyacht/internal/platform/config"
	"goyacht/internal/platform/i18n"
	"goyacht/internal/platform/secure"
	"goyacht/locales"
)

// documentedOperations reads "path -> methods" from docs/openapi.yaml without a YAML
// dependency; the file uses a fixed two/four-space layout for paths and methods.
func documentedOperations(t *testing.T) map[string]bool {
	f, err := os.Open("../../../docs/openapi.yaml")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = f.Close() }()
	ops := map[string]bool{}
	inPaths, current := false, ""
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := sc.Text()
		switch {
		case line == "paths:":
			inPaths = true
		case inPaths && len(line) > 0 && line[0] != ' ':
			inPaths = false
		case inPaths && strings.HasPrefix(line, "  /"):
			current = strings.TrimSuffix(strings.TrimSpace(line), ":")
		case inPaths && strings.HasPrefix(line, "    ") && !strings.HasPrefix(line, "     ") && strings.HasSuffix(line, ":"):
			ops[strings.ToUpper(strings.TrimSuffix(strings.TrimSpace(line), ":"))+" "+current] = true
		}
	}
	return ops
}

func TestOpenAPICoversRouter(t *testing.T) {
	cipher, err := secure.NewCipher(map[string][]byte{"k": make([]byte, 32)}, "k")
	if err != nil {
		t.Fatal(err)
	}
	msgs, err := i18n.Load(locales.FS, ".")
	if err != nil {
		t.Fatal(err)
	}
	cfg, err := testConfig()
	if err != nil {
		t.Fatal(err)
	}
	d := NewDepsWith(cfg, nil, nil, cipher, msgs)
	router := NewRouter(d, NewModules(d, NewServices(d, nil, nil))).(chi.Router)
	documented := documentedOperations(t)
	err = chi.Walk(router, func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		if !strings.HasPrefix(route, "/api/v1/") || method == http.MethodOptions {
			return nil
		}
		route = strings.TrimSuffix(strings.ReplaceAll(route, "/*/", "/"), "/*")
		if !documented[method+" "+route] {
			t.Errorf("%s %s is not documented in docs/openapi.yaml", method, route)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

func testConfig() (*config.Config, error) {
	for k, v := range map[string]string{
		"APP_URL": "http://app.test", "DATABASE_URL": "postgres://x", "IDENTITY_ENCRYPTION_KEYS": "k:" + strings.Repeat("A", 43) + "=",
		"IDENTITY_ENCRYPTION_ACTIVE_KEY": "k", "S3_ENDPOINT": "s3:1", "S3_ACCESS_KEY": "a", "S3_SECRET_KEY": "b", "MEDIA_PUBLIC_URL": "http://m",
	} {
		if os.Getenv(k) == "" {
			_ = os.Setenv(k, v)
		}
	}
	return config.Load()
}
