package scenarios

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"goyacht/internal/integrations/google"
	"goyacht/internal/modules/auth"
	"goyacht/internal/platform/db/dbq"
	"goyacht/internal/platform/jobs"
	"goyacht/internal/testutil"
)

const customerEmail, customerPassword = "guest@example.com", "sea-breeze-42"

func register(t *testing.T, c *testutil.Client, email string) testutil.Response {
	t.Helper()
	return c.Post(t, "/api/v1/auth/register", map[string]string{"email": email, "full_name": "Sea Guest", "locale": "id", "return_to": "/checkout?boat=ocean"})
}

func confirm(t *testing.T, c *testutil.Client, token, password string) testutil.Response {
	t.Helper()
	return c.Post(t, "/api/v1/auth/verify-email", map[string]string{"token": token, "password": password})
}

func customerLogin(t *testing.T, c *testutil.Client, email, password string) testutil.Response {
	t.Helper()
	return c.Post(t, "/api/v1/auth/login", map[string]string{"email": email, "password": password})
}

var linkToken = regexp.MustCompile(`token=([A-Za-z0-9_-]+)`)

// authToken runs the newest queued auth email of one template through the worker and returns the
// token from the link it mailed.
func authToken(t *testing.T, env *testutil.Env, template string) string {
	t.Helper()
	var raw []byte
	if err := env.Pool.QueryRow(context.Background(), `SELECT args FROM river_job WHERE kind = 'send_auth_email' AND args->>'template' = $1 ORDER BY id DESC LIMIT 1`, template).Scan(&raw); err != nil {
		t.Fatalf("no %s email queued: %v", template, err)
	}
	var a jobs.SendAuthEmail
	if err := json.Unmarshal(raw, &a); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "token") {
		t.Fatalf("job args carry a token: %s", raw)
	}
	if err := env.Services.Notifications.SendAuthEmail(context.Background(), a); err != nil {
		t.Fatal(err)
	}
	m := linkToken.FindStringSubmatch(env.Sender.Sent[len(env.Sender.Sent)-1].Text)
	if m == nil {
		t.Fatalf("no link in the %s email", template)
	}
	return m[1]
}

func countAuthEmails(t *testing.T, env *testutil.Env) int {
	t.Helper()
	var n int
	if err := env.Pool.QueryRow(context.Background(), `SELECT count(*) FROM river_job WHERE kind = 'send_auth_email'`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func customerID(t *testing.T, env *testutil.Env, email string) []uuid.UUID {
	t.Helper()
	rows, err := env.Pool.Query(context.Background(), `SELECT id FROM users WHERE lower(email) = $1 ORDER BY created_at`, email)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var ids []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			t.Fatal(err)
		}
		ids = append(ids, id)
	}
	return ids
}

func googleSignIn(t *testing.T, env *testutil.Env, subject, email string) auth.LoginResult {
	t.Helper()
	ctx := context.Background()
	svc := auth.NewService(env.Pool, fakeGoogle{ident: google.Identity{Subject: subject, Email: email, EmailVerified: true}},
		auth.NewSessions(env.Pool, "gy_session", time.Hour, false), nil)
	state := "s" + uuid.NewString()
	if err := dbq.New(env.Pool).InsertOAuthState(ctx, dbq.InsertOAuthStateParams{State: state, CodeVerifier: "v", Nonce: "n", ReturnTo: "/", ExpiresAt: time.Now().Add(time.Hour)}); err != nil {
		t.Fatal(err)
	}
	res, err := svc.CompleteLogin(ctx, httptest.NewRecorder(), httptest.NewRequest("GET", "/", nil), state, "code")
	if err != nil {
		t.Fatal(err)
	}
	return res
}

func TestCustomerRegistersConfirmsAndSignsIn(t *testing.T) {
	env := testutil.NewEnv(t)
	c := env.Anonymous()
	if r := register(t, c, " Guest@Example.com "); r.Status != http.StatusAccepted {
		t.Fatalf("register: %d %s", r.Status, r.Body)
	}
	if code := customerLogin(t, c, customerEmail, customerPassword).ErrorCode(t); code != "INVALID_CREDENTIALS" {
		t.Fatalf("login before confirming: %s", code)
	}

	token := authToken(t, env, auth.TemplateVerify)
	sent := env.Sender.Sent[len(env.Sender.Sent)-1]
	if !strings.Contains(sent.Subject, "pendaftaran") || !strings.Contains(sent.Text, "http://app.test/id/verify-email?") || !strings.Contains(sent.Text, "return_to=%2Fcheckout%3Fboat%3Docean") {
		t.Fatalf("confirmation email: %q\n%s", sent.Subject, sent.Text)
	}

	if code := confirm(t, c, token, "short").ErrorCode(t); code != "VALIDATION_FAILED" {
		t.Fatalf("short password: %s", code)
	}
	if r := confirm(t, c, token, customerPassword); r.Status != http.StatusNoContent {
		t.Fatalf("confirm after a rejected password must still work: %d %s", r.Status, r.Body)
	}
	var me struct {
		Email         string `json:"email"`
		Role          string `json:"role"`
		Locale        string `json:"locale"`
		EmailVerified bool   `json:"email_verified"`
	}
	c.Get(t, "/api/v1/auth/me").Data(t, &me)
	if me.Email != customerEmail || me.Role != auth.RoleCustomer || me.Locale != "id" || !me.EmailVerified {
		t.Fatalf("me after confirming: %+v", me)
	}
	if code := confirm(t, c, token, "another-pass-1").ErrorCode(t); code != "TOKEN_INVALID" {
		t.Fatalf("second use of the link: %s", code)
	}
	if r := customerLogin(t, env.Anonymous(), customerEmail, customerPassword); r.Status != http.StatusNoContent {
		t.Fatalf("login after confirming: %d %s", r.Status, r.Body)
	}
}

// Someone signs up with an address they do not own. The owner follows the link that reached
// their inbox and chooses the password, so the stranger is left with nothing.
func TestSigningUpWithSomeoneElsesAddressGivesNoAccess(t *testing.T) {
	env := testutil.NewEnv(t)
	stranger := env.Anonymous()
	register(t, stranger, customerEmail)
	owner := env.Anonymous()
	if r := confirm(t, owner, authToken(t, env, auth.TemplateVerify), "owner-chosen-pass"); r.Status != http.StatusNoContent {
		t.Fatalf("owner confirms: %d %s", r.Status, r.Body)
	}
	if r := stranger.Get(t, "/api/v1/auth/me"); r.Status != http.StatusUnauthorized {
		t.Fatalf("the stranger got a session: %d", r.Status)
	}
	if r := customerLogin(t, env.Anonymous(), customerEmail, "owner-chosen-pass"); r.Status != http.StatusNoContent {
		t.Fatalf("owner login: %d", r.Status)
	}
}

func TestRegisteringAKnownAddressChangesNothing(t *testing.T) {
	env := testutil.NewEnv(t)
	_, googleUser := env.Login(t, customerEmail, auth.RoleCustomer)
	c := env.Anonymous()

	if r := register(t, c, customerEmail); r.Status != http.StatusAccepted {
		t.Fatalf("register over an existing account must look like any other: %d %s", r.Status, r.Body)
	}
	if ids := customerID(t, env, customerEmail); len(ids) != 1 {
		t.Fatalf("accounts for one address: %d", len(ids))
	}
	if n := countAuthEmails(t, env); n != 1 {
		t.Fatalf("emails queued: %d", n)
	}

	// The owner is told about the attempt and sets a password through their inbox.
	token := authToken(t, env, auth.TemplateAccountExists)
	if r := c.Post(t, "/api/v1/auth/password/reset", map[string]string{"token": token, "password": "owner-chosen-pass"}); r.Status != http.StatusNoContent {
		t.Fatalf("reset: %d %s", r.Status, r.Body)
	}
	if r := customerLogin(t, c, customerEmail, "owner-chosen-pass"); r.Status != http.StatusNoContent {
		t.Fatalf("login with the owner's password: %d %s", r.Status, r.Body)
	}
	var me struct {
		ID string `json:"id"`
	}
	c.Get(t, "/api/v1/auth/me").Data(t, &me)
	if me.ID != googleUser.String() {
		t.Fatalf("password login opened account %s, Google account is %s", me.ID, googleUser)
	}
}

func TestGoogleSignInJoinsTheEmailAccount(t *testing.T) {
	env := testutil.NewEnv(t)
	c := env.Anonymous()
	register(t, c, customerEmail)
	confirm(t, c, authToken(t, env, auth.TemplateVerify), customerPassword)
	owner := customerID(t, env, customerEmail)[0]

	res := googleSignIn(t, env, "sub-guest", customerEmail)
	if res.User.ID != owner || res.Created {
		t.Fatalf("Google sign-in made a second account: %s vs %s (created %v)", res.User.ID, owner, res.Created)
	}
	if r := customerLogin(t, env.Anonymous(), customerEmail, customerPassword); r.Status != http.StatusNoContent {
		t.Fatalf("password stopped working after Google joined: %d", r.Status)
	}
}

func TestGoogleSignInTakesOverAnUnconfirmedSignUp(t *testing.T) {
	env := testutil.NewEnv(t)
	register(t, env.Anonymous(), customerEmail)
	res := googleSignIn(t, env, "sub-owner", customerEmail)
	if len(customerID(t, env, customerEmail)) != 1 || res.Created || res.User.EmailVerifiedAt == nil {
		t.Fatalf("Google did not take over the pending sign-up: created=%v", res.Created)
	}
}

func TestPasswordResetEndsSessionsAndIsSilentAboutUnknownAddresses(t *testing.T) {
	env := testutil.NewEnv(t)
	session, _ := env.Login(t, customerEmail, auth.RoleCustomer)
	c := env.Anonymous()

	if r := c.Post(t, "/api/v1/auth/password/forgot", map[string]string{"email": "nobody@example.com"}); r.Status != http.StatusAccepted {
		t.Fatalf("unknown address: %d", r.Status)
	}
	if n := countAuthEmails(t, env); n != 0 {
		t.Fatalf("mail queued for an unknown address: %d", n)
	}
	if r := c.Post(t, "/api/v1/auth/password/forgot", map[string]string{"email": customerEmail}); r.Status != http.StatusAccepted {
		t.Fatalf("known address: %d", r.Status)
	}
	token := authToken(t, env, auth.TemplateReset)
	if code := c.Post(t, "/api/v1/auth/password/reset", map[string]string{"token": token, "password": "short"}).ErrorCode(t); code != "VALIDATION_FAILED" {
		t.Fatalf("short password: %s", code)
	}
	if r := c.Post(t, "/api/v1/auth/password/reset", map[string]string{"token": token, "password": "new-long-pass"}); r.Status != http.StatusNoContent {
		t.Fatalf("reset: %d %s", r.Status, r.Body)
	}
	if r := session.Get(t, "/api/v1/auth/me"); r.Status != http.StatusUnauthorized {
		t.Fatalf("old session survived the reset: %d", r.Status)
	}
	if code := c.Post(t, "/api/v1/auth/password/reset", map[string]string{"token": token, "password": "another-pass"}).ErrorCode(t); code != "TOKEN_INVALID" {
		t.Fatalf("reset link reused: %s", code)
	}
}

func TestBookingNeedsAConfirmedEmail(t *testing.T) {
	env := testutil.NewEnv(t)
	c, userID := env.Login(t, customerEmail, auth.RoleCustomer)
	if _, err := env.Pool.Exec(context.Background(), `UPDATE users SET email_verified_at = NULL WHERE id = $1`, userID); err != nil {
		t.Fatal(err)
	}
	r := c.Do(t, http.MethodPost, "/api/v1/bookings", map[string]any{}, map[string]string{"Idempotency-Key": uuid.NewString()})
	if r.Status != http.StatusForbidden || r.ErrorCode(t) != "EMAIL_NOT_VERIFIED" {
		t.Fatalf("booking with an unconfirmed email: %d %s", r.Status, r.Body)
	}
}

func TestSafeReturnPathRefusesWaysOffSite(t *testing.T) {
	for _, p := range []string{"https://x.example", "//x.example", `/\x.example`, "/\t/x.example", "/\n/x.example", "/\x00/x"} {
		if got := auth.SafeReturnPath(p); got != "/" {
			t.Errorf("SafeReturnPath(%q) = %q", p, got)
		}
	}
	if got := auth.SafeReturnPath("/id/checkout?boat=ocean"); got != "/id/checkout?boat=ocean" {
		t.Errorf("same-site path changed: %q", got)
	}
}
