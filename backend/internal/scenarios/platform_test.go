package scenarios

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/png"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"goyacht/internal/integrations/google"
	"goyacht/internal/integrations/storage"
	"goyacht/internal/modules/auth"
	"goyacht/internal/modules/media"
	"goyacht/internal/platform/db"
	"goyacht/internal/platform/db/dbq"
	"goyacht/internal/platform/jobs"
	"goyacht/internal/testutil"
)

// Scenario 22: a non-image renamed to .jpg and an oversized image are rejected at upload.
func TestScenario22UploadValidation(t *testing.T) {
	env := testutil.NewEnv(t)
	svc := env.Services.Media
	alts := map[string]string{"en": "alt", "id": "alt"}
	_, err := svc.Upload(context.Background(), media.UploadInput{Data: []byte("this is not an image, just text pretending to be photo.jpg"), Slug: "x", Bucket: storage.Public, AltTexts: alts})
	if !errors.Is(err, media.ErrNotImage) {
		t.Fatalf("expected MEDIA_UNSUPPORTED_TYPE, got %v", err)
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, image.NewGray(image.Rect(0, 0, 13000, 1))); err != nil {
		t.Fatal(err)
	}
	_, err = svc.Upload(context.Background(), media.UploadInput{Data: buf.Bytes(), Slug: "x", Bucket: storage.Public, AltTexts: alts})
	if !errors.Is(err, media.ErrDimensions) {
		t.Fatalf("expected MEDIA_DIMENSIONS_TOO_LARGE, got %v", err)
	}
	truncated := buf.Bytes()[:20]
	if _, err := svc.Upload(context.Background(), media.UploadInput{Data: truncated, Slug: "x", Bucket: storage.Public, AltTexts: alts}); err == nil {
		t.Fatal("truncated image must be rejected")
	}
	big := make([]byte, media.MaxUploadBytes+1)
	if _, err := svc.Upload(context.Background(), media.UploadInput{Data: big, Slug: "x", Bucket: storage.Public, AltTexts: alts}); !errors.Is(err, media.ErrFileTooLarge) {
		t.Fatalf("expected MEDIA_FILE_TOO_LARGE, got %v", err)
	}
}

func readyMedia(t *testing.T, env *testutil.Env, name string) uuid.UUID {
	t.Helper()
	key := name + "-800.webp"
	if err := env.Store.Put(context.Background(), storage.Public, key, []byte("webp"), "image/webp"); err != nil {
		t.Fatal(err)
	}
	var id uuid.UUID
	if err := env.Pool.QueryRow(context.Background(), `INSERT INTO media (bucket, base_name, status, content_type, variants, created_at)
		VALUES ('PUBLIC', $1, 'READY', 'image/webp', jsonb_build_array(jsonb_build_object('width', 800, 'height', 600, 'key', $2::text)), now() - interval '2 days') RETURNING id`, name, key).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

// Scenario 23: replacing an image inside a transaction that fails leaves the old file in place
// and still in use; a committed replacement removes it through the cleanup job.
func TestScenario23ImageReplaceRollback(t *testing.T) {
	env := testutil.NewEnv(t)
	ctx := context.Background()
	svc := env.Services.Media
	entity := uuid.New()
	oldID, newID := readyMedia(t, env, "old"), readyMedia(t, env, "new")
	if err := db.InTx(ctx, env.Pool, func(tx pgx.Tx) error { return svc.SetUsages(ctx, tx, "region", entity, "thumbnail", []uuid.UUID{oldID}) }); err != nil {
		t.Fatal(err)
	}
	boom := errors.New("later step failed")
	err := db.InTx(ctx, env.Pool, func(tx pgx.Tx) error {
		if err := svc.SetUsages(ctx, tx, "region", entity, "thumbnail", []uuid.UUID{newID}); err != nil {
			return err
		}
		return boom
	})
	if !errors.Is(err, boom) {
		t.Fatal(err)
	}
	if err := svc.CleanupOrphans(ctx); err != nil {
		t.Fatal(err)
	}
	if !env.Store.Has(storage.Public, "old-800.webp") {
		t.Fatal("old file deleted although the replacement rolled back")
	}
	var deleteJobs int
	_ = env.Pool.QueryRow(ctx, `SELECT count(*) FROM river_job WHERE kind = 'delete_media'`).Scan(&deleteJobs)
	if deleteJobs != 0 {
		t.Fatal("deletion job survived a rolled-back transaction")
	}
	if err := db.InTx(ctx, env.Pool, func(tx pgx.Tx) error { return svc.SetUsages(ctx, tx, "region", entity, "thumbnail", []uuid.UUID{newID}) }); err != nil {
		t.Fatal(err)
	}
	if err := svc.DeleteUnused(ctx, []uuid.UUID{oldID}); err != nil {
		t.Fatal(err)
	}
	if env.Store.Has(storage.Public, "old-800.webp") || !env.Store.Has(storage.Public, "new-800.webp") {
		t.Fatal("committed replacement should remove only the old file")
	}
}

// Scenario 24: a notification job that runs again after a crash or retry does not send twice.
func TestScenario24EmailOnce(t *testing.T) {
	env := testutil.NewEnv(t)
	f := testutil.NewFixture(t, env.Pool, testutil.FixtureOptions{})
	c, _ := env.Login(t, "c@test.dev", "CUSTOMER")
	b := book(t, c, testutil.CharterBooking(f, testutil.LocalDate(10), "09:00", 2, 2))
	var internal uuid.UUID
	_ = env.Pool.QueryRow(context.Background(), `SELECT id FROM bookings WHERE public_id = $1`, b.ID).Scan(&internal)
	n := jobs.Notify{Template: "booking_created", BookingID: &internal, DedupeKey: "booking_created:" + internal.String(), Audience: jobs.AudienceCustomer}
	env.Sender.Fail = true
	if err := env.Services.Notifications.Send(context.Background(), n); err == nil {
		t.Fatal("expected first attempt to fail")
	}
	env.Sender.Fail = false
	for i := 0; i < 3; i++ {
		if err := env.Services.Notifications.Send(context.Background(), n); err != nil {
			t.Fatal(err)
		}
	}
	if env.Sender.Count() != 1 {
		t.Fatalf("expected exactly one email, got %d", env.Sender.Count())
	}
}

type fakeGoogle struct{ ident google.Identity }

func (f fakeGoogle) AuthURL(string, string, string) (string, error) { return "https://accounts.test", nil }
func (f fakeGoogle) Exchange(context.Context, string, string, string) (google.Identity, error) {
	return f.ident, nil
}

// Scenario 25: a Google account with an unverified email cannot log in.
func TestScenario25UnverifiedEmail(t *testing.T) {
	pool := testutil.NewDatabase(t)
	ctx := context.Background()
	login := func(verified bool) error {
		svc := auth.NewService(pool, fakeGoogle{ident: google.Identity{Subject: "sub-1", Email: "u@test.dev", EmailVerified: verified, Name: "U"}},
			auth.NewSessions(pool, "gy_session", time.Hour, false), nil)
		if err := dbq.New(pool).InsertOAuthState(ctx, dbq.InsertOAuthStateParams{State: "s" + uuid.NewString(), CodeVerifier: "v", Nonce: "n", ReturnTo: "/", ExpiresAt: time.Now().Add(time.Minute)}); err != nil {
			t.Fatal(err)
		}
		var state string
		_ = pool.QueryRow(ctx, `SELECT state FROM oauth_states ORDER BY created_at DESC LIMIT 1`).Scan(&state)
		_, err := svc.CompleteLogin(ctx, httptest.NewRecorder(), httptest.NewRequest("GET", "/", nil), state, "code")
		return err
	}
	if err := login(false); !errors.Is(err, auth.ErrEmailNotVerified) {
		t.Fatalf("expected EMAIL_NOT_VERIFIED, got %v", err)
	}
	var users int
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM users`).Scan(&users)
	if users != 0 {
		t.Fatal("unverified login must not create a user")
	}
}

// Scenario 27: the commit-msg hook rejects AI co-author trailers.
func TestScenario27CommitHook(t *testing.T) {
	hook, err := filepath.Abs("../../../.githooks/commit-msg")
	if err != nil {
		t.Fatal(err)
	}
	run := func(msg string) error {
		f := filepath.Join(t.TempDir(), "MSG")
		if err := os.WriteFile(f, []byte(msg), 0o600); err != nil {
			t.Fatal(err)
		}
		return exec.Command("sh", hook, f).Run()
	}
	if err := run("Fix booking hold\n\nCo-authored-by: Claude <noreply@anthropic.com>\n"); err == nil {
		t.Fatal("AI trailer must be rejected")
	}
	if err := run("Add feature\n\nGenerated with ChatGPT\n"); err == nil {
		t.Fatal("AI footer must be rejected")
	}
	if err := run("Fix booking hold\n\nCo-authored-by: Jane Doe <jane@example.com>\n"); err != nil {
		t.Fatalf("human co-author must be accepted: %v", err)
	}
}
