// Package testutil provides a real PostgreSQL database per test package and an in-process API
// server. Tests never mock the database (AGENTS.md section 18).
package testutil

import (
	"context"
	"database/sql"
	"fmt"
	"io/fs"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"
	"github.com/riverqueue/river/rivermigrate"

	"goyacht/db"
	"goyacht/internal/app"
	"goyacht/internal/integrations/midtrans"
	"goyacht/internal/integrations/smtp"
	"goyacht/internal/integrations/storage"
	"goyacht/internal/platform/config"
	"goyacht/internal/platform/i18n"
	"goyacht/internal/platform/secure"
	"goyacht/locales"
)

// NewDatabase creates an isolated database from TEST_DATABASE_URL, applies all migrations and
// drops it when the test finishes. Tests are skipped when no database is configured.
func NewDatabase(t testing.TB) *pgxpool.Pool {
	t.Helper()
	base := os.Getenv("TEST_DATABASE_URL")
	if base == "" {
		t.Skip("TEST_DATABASE_URL not set; integration tests need a real PostgreSQL")
	}
	ctx := context.Background()
	admin, err := pgx.Connect(ctx, base)
	if err != nil {
		t.Fatalf("connect admin: %v", err)
	}
	name := "gy_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")[:16]
	if _, err := admin.Exec(ctx, "CREATE DATABASE "+name); err != nil {
		t.Fatalf("create db: %v", err)
	}
	u, _ := url.Parse(base)
	u.Path = "/" + name
	dsn := u.String()

	sqlDB, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	migrations, _ := fs.Sub(db.Migrations, "migrations")
	provider, err := goose.NewProvider(goose.DialectPostgres, sqlDB, migrations)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := provider.Up(ctx); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	_ = sqlDB.Close()

	cfg, _ := pgxpool.ParseConfig(dsn)
	cfg.MaxConns = 40
	cfg.ConnConfig.RuntimeParams["timezone"] = "UTC"
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	rm, err := rivermigrate.New(riverpgxv5.New(pool), nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := rm.Migrate(ctx, rivermigrate.DirectionUp, nil); err != nil {
		t.Fatalf("river migrate: %v", err)
	}
	t.Cleanup(func() {
		pool.Close()
		_, _ = admin.Exec(context.Background(), "DROP DATABASE IF EXISTS "+name+" WITH (FORCE)")
		_ = admin.Close(context.Background())
	})
	return pool
}

// FakeGateway is an in-memory Midtrans used to drive webhook scenarios deterministically.
type FakeGateway struct {
	mu        sync.Mutex
	ServerKey string
	Statuses  map[string]midtrans.Status
	Created   []midtrans.SnapRequest
	Refunds   []string
}

func NewFakeGateway() *FakeGateway {
	return &FakeGateway{ServerKey: "test-server-key", Statuses: map[string]midtrans.Status{}}
}

func (g *FakeGateway) CreateSnap(_ context.Context, r midtrans.SnapRequest) (midtrans.SnapResponse, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.Created = append(g.Created, r)
	return midtrans.SnapResponse{Token: "tok-" + r.OrderID, RedirectURL: "https://example.test/" + r.OrderID}, nil
}

func (g *FakeGateway) SetStatus(st midtrans.Status) {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.Statuses[st.OrderID] = st
}

func (g *FakeGateway) GetStatus(_ context.Context, orderID string) (midtrans.Status, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	st, ok := g.Statuses[orderID]
	if !ok {
		return midtrans.Status{}, midtrans.ErrNotFound
	}
	return st, nil
}

func (g *FakeGateway) Cancel(context.Context, string) error { return midtrans.ErrNotFound }

func (g *FakeGateway) Refund(_ context.Context, orderID, key string, _ int64, _ string) error {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.Refunds = append(g.Refunds, orderID+":"+key)
	return nil
}

func (g *FakeGateway) VerifySignature(orderID, statusCode, grossAmount, signature string) bool {
	return midtrans.VerifySignature(g.ServerKey, orderID, statusCode, grossAmount, signature)
}

func (g *FakeGateway) ClientKey() string { return "client" }
func (g *FakeGateway) SnapJSURL() string { return "https://example.test/snap.js" }

// FakeSender records outgoing mail.
type FakeSender struct {
	mu   sync.Mutex
	Sent []smtp.Message
	Fail bool
}

func (s *FakeSender) Send(_ context.Context, m smtp.Message) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.Fail {
		return fmt.Errorf("smtp down")
	}
	s.Sent = append(s.Sent, m)
	return nil
}

func (s *FakeSender) Count() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.Sent)
}

// MemoryStore is an in-memory object store for media tests.
type MemoryStore struct {
	mu      sync.Mutex
	Objects map[string][]byte
}

func NewMemoryStore() *MemoryStore { return &MemoryStore{Objects: map[string][]byte{}} }

func (m *MemoryStore) key(b storage.Bucket, k string) string { return string(b) + "/" + k }

func (m *MemoryStore) Put(_ context.Context, b storage.Bucket, k string, data []byte, _ string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.Objects[m.key(b, k)] = append([]byte(nil), data...)
	return nil
}

func (m *MemoryStore) Delete(_ context.Context, b storage.Bucket, k string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.Objects, m.key(b, k))
	return nil
}

func (m *MemoryStore) Get(_ context.Context, b storage.Bucket, k string) ([]byte, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	d, ok := m.Objects[m.key(b, k)]
	if !ok {
		return nil, fmt.Errorf("not found")
	}
	return d, nil
}

func (m *MemoryStore) PresignGet(context.Context, storage.Bucket, string, time.Duration) (string, error) {
	return "", nil
}

func (m *MemoryStore) PublicURL(k string) string { return "http://media.test/" + k }

func (m *MemoryStore) Has(b storage.Bucket, k string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	_, ok := m.Objects[m.key(b, k)]
	return ok
}

// Env bundles a running API server with its dependencies and fakes.
type Env struct {
	Pool     *pgxpool.Pool
	Server   *httptest.Server
	Deps     *app.Deps
	Services *app.Services
	Gateway  *FakeGateway
	Sender   *FakeSender
	Store    *MemoryStore
}

func Config() *config.Config {
	u, _ := url.Parse("http://app.test")
	return &config.Config{Env: "test", AppURL: u, APIURL: u, CORSOrigin: []string{"http://app.test"}, SessionCookieName: "gy_session",
		SessionTTL: 30 * 24 * time.Hour, MailFromAddress: "no-reply@app.test", MailFromName: "GoYacht"}
}

func NewEnv(t testing.TB) *Env {
	t.Helper()
	pool := NewDatabase(t)
	cfg := Config()
	cipher, err := secure.NewCipher(map[string][]byte{"k1": make([]byte, 32)}, "k1")
	if err != nil {
		t.Fatal(err)
	}
	msgs, err := i18n.Load(locales.FS, ".")
	if err != nil {
		t.Fatal(err)
	}
	store := NewMemoryStore()
	deps := app.NewDepsWith(cfg, pool, store, cipher, msgs)
	if err := deps.StartRiver(&river.Config{}); err != nil {
		t.Fatal(err)
	}
	gw, sender := NewFakeGateway(), &FakeSender{}
	svc := app.NewServices(deps, gw, sender)
	srv := httptest.NewServer(app.NewRouter(deps, app.NewModules(deps, svc)))
	t.Cleanup(srv.Close)
	return &Env{Pool: pool, Server: srv, Deps: deps, Services: svc, Gateway: gw, Sender: sender, Store: store}
}

// Login creates a user with an active session and returns a client that sends its cookies and
// CSRF header on every request.
func (e *Env) Login(t testing.TB, email, role string) (*Client, uuid.UUID) {
	t.Helper()
	ctx := context.Background()
	var userID uuid.UUID
	if err := e.Pool.QueryRow(ctx, `INSERT INTO users (provider, provider_subject, email, full_name, role, email_verified_at) VALUES ('google', $1, $1, 'Test User', $2, now()) RETURNING id`, email, role).Scan(&userID); err != nil {
		t.Fatal(err)
	}
	token, csrf := secure.RandomToken(32), secure.RandomToken(24)
	if _, err := e.Pool.Exec(ctx, `INSERT INTO sessions (token_hash, user_id, csrf_token, expires_at) VALUES ($1, $2, $3, now() + interval '1 day')`, secure.HashToken(token), userID, csrf); err != nil {
		t.Fatal(err)
	}
	return &Client{base: e.Server.URL, http: e.Server.Client(), cookie: token, csrf: csrf}, userID
}

func (e *Env) Anonymous() *Client { return &Client{base: e.Server.URL, http: e.Server.Client()} }
