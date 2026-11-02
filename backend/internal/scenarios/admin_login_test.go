package scenarios

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"goyacht/internal/integrations/google"
	"goyacht/internal/modules/auth"
	"goyacht/internal/platform/db/dbq"
	"goyacht/internal/testutil"
)

const adminEmail, adminPassword = "owner@example.com", "correct-horse-battery"

func seedAdmin(t *testing.T, env *testutil.Env) {
	t.Helper()
	if err := auth.CreateAdmin(context.Background(), env.Pool, adminEmail, "Owner", adminPassword, nil); err != nil {
		t.Fatal(err)
	}
}

func adminLogin(t *testing.T, c *testutil.Client, email, password string) testutil.Response {
	t.Helper()
	return c.Post(t, "/api/v1/auth/admin/login", map[string]string{"email": email, "password": password})
}

func TestAdminLoginStartsAnAdminSession(t *testing.T) {
	env := testutil.NewEnv(t)
	seedAdmin(t, env)
	c := env.Anonymous()

	res := adminLogin(t, c, "  OWNER@example.com ", adminPassword)
	if res.Status != http.StatusOK {
		t.Fatalf("login: %d %s", res.Status, res.Body)
	}
	var me struct {
		Role string `json:"role"`
	}
	c.Get(t, "/api/v1/auth/me").Data(t, &me)
	if me.Role != auth.RoleAdmin {
		t.Fatalf("role = %q", me.Role)
	}
	if r := c.Get(t, "/api/v1/admin/users"); r.Status != http.StatusOK {
		t.Fatalf("admin API with the new session: %d", r.Status)
	}
	if strings.Contains(string(c.Get(t, "/api/v1/admin/users").Body), "$2a$") {
		t.Fatal("password hash leaked through the users API")
	}
}

func TestAdminLoginGivesOneAnswerForEveryFailure(t *testing.T) {
	env := testutil.NewEnv(t)
	seedAdmin(t, env)
	_, _ = env.Login(t, "customer@example.com", auth.RoleCustomer)
	c := env.Anonymous()

	for name, creds := range map[string][2]string{
		"wrong password": {adminEmail, "not-the-password"},
		"unknown email":  {"nobody@example.com", adminPassword},
		"customer email": {"customer@example.com", adminPassword},
		"empty password": {adminEmail, ""},
	} {
		res := adminLogin(t, c, creds[0], creds[1])
		if res.Status != http.StatusUnauthorized || res.ErrorCode(t) != "INVALID_CREDENTIALS" {
			t.Fatalf("%s: %d %s", name, res.Status, res.Body)
		}
	}
	if r := c.Get(t, "/api/v1/auth/me"); r.Status != http.StatusUnauthorized {
		t.Fatalf("failed logins must not start a session: %d", r.Status)
	}
}

func TestAdminLoginLocksAfterFiveFailures(t *testing.T) {
	env := testutil.NewEnv(t)
	seedAdmin(t, env)
	c := env.Anonymous()
	for range 5 {
		adminLogin(t, c, adminEmail, "not-the-password")
	}
	res := adminLogin(t, c, adminEmail, adminPassword)
	if res.Status != http.StatusUnauthorized || res.ErrorCode(t) != "INVALID_CREDENTIALS" {
		t.Fatalf("locked account accepted the right password: %d %s", res.Status, res.Body)
	}

	if _, err := env.Pool.Exec(context.Background(), `UPDATE users SET locked_until = now() - interval '1 second' WHERE lower(email) = $1`, adminEmail); err != nil {
		t.Fatal(err)
	}
	if res := adminLogin(t, c, adminEmail, adminPassword); res.Status != http.StatusOK {
		t.Fatalf("login after the lock ended: %d %s", res.Status, res.Body)
	}
}

func TestDisabledAdminCannotLogIn(t *testing.T) {
	env := testutil.NewEnv(t)
	seedAdmin(t, env)
	if _, err := env.Pool.Exec(context.Background(), `UPDATE users SET status = 'DISABLED' WHERE lower(email) = $1`, adminEmail); err != nil {
		t.Fatal(err)
	}
	res := adminLogin(t, env.Anonymous(), adminEmail, adminPassword)
	if res.Status != http.StatusUnauthorized || res.ErrorCode(t) != "INVALID_CREDENTIALS" {
		t.Fatalf("disabled admin: %d %s", res.Status, res.Body)
	}
}

func TestAdminChangesOwnPassword(t *testing.T) {
	env := testutil.NewEnv(t)
	seedAdmin(t, env)
	first, second := env.Anonymous(), env.Anonymous()
	adminLogin(t, first, adminEmail, adminPassword)
	adminLogin(t, second, adminEmail, adminPassword)

	change := func(current, next string) testutil.Response {
		return first.Post(t, "/api/v1/auth/password", map[string]string{"current_password": current, "new_password": next})
	}
	if r := change("wrong-current-password", "a-brand-new-password"); r.Status != http.StatusUnauthorized || r.ErrorCode(t) != "INVALID_CREDENTIALS" {
		t.Fatalf("wrong current password: %d %s", r.Status, r.Body)
	}
	if r := change(adminPassword, "short"); r.Status != http.StatusUnprocessableEntity {
		t.Fatalf("short password: %d %s", r.Status, r.Body)
	}
	if r := change(adminPassword, "a-brand-new-password"); r.Status != http.StatusNoContent {
		t.Fatalf("change: %d %s", r.Status, r.Body)
	}
	if r := second.Get(t, "/api/v1/auth/me"); r.Status != http.StatusUnauthorized {
		t.Fatalf("other sessions must end after a password change: %d", r.Status)
	}
	if r := first.Get(t, "/api/v1/auth/me"); r.Status != http.StatusOK {
		t.Fatalf("the session that changed the password stays signed in: %d", r.Status)
	}
	if r := adminLogin(t, env.Anonymous(), adminEmail, adminPassword); r.Status != http.StatusUnauthorized {
		t.Fatalf("old password still works: %d", r.Status)
	}
	if r := adminLogin(t, env.Anonymous(), adminEmail, "a-brand-new-password"); r.Status != http.StatusOK {
		t.Fatalf("new password refused: %d", r.Status)
	}
}

func TestCustomerCannotUseAdminPasswordEndpoints(t *testing.T) {
	env := testutil.NewEnv(t)
	customer, _ := env.Login(t, "customer@example.com", auth.RoleCustomer)
	if r := customer.Post(t, "/api/v1/auth/password", map[string]string{"current_password": "x", "new_password": "a-brand-new-password"}); r.Status != http.StatusForbidden {
		t.Fatalf("customer changing a password: %d", r.Status)
	}
	if r := customer.Post(t, "/api/v1/admin/admins", map[string]string{"email": "a@example.com", "full_name": "A", "password": "a-brand-new-password"}); r.Status != http.StatusForbidden {
		t.Fatalf("customer creating an admin: %d", r.Status)
	}
}

func TestAdminCreatesAnotherAdmin(t *testing.T) {
	env := testutil.NewEnv(t)
	admin, _ := env.Login(t, "boss@example.com", auth.RoleAdmin)

	create := func(email, password string) testutil.Response {
		return admin.Post(t, "/api/v1/admin/admins", map[string]string{"email": email, "full_name": "New Admin", "password": password})
	}
	if r := create("not-an-email", "a-brand-new-password"); r.Status != http.StatusUnprocessableEntity {
		t.Fatalf("bad email: %d", r.Status)
	}
	if r := create("second@example.com", "short"); r.Status != http.StatusUnprocessableEntity {
		t.Fatalf("short password: %d", r.Status)
	}
	if r := create("Second@example.com", "a-brand-new-password"); r.Status != http.StatusCreated {
		t.Fatalf("create: %d %s", r.Status, r.Body)
	}
	if r := create("second@EXAMPLE.com", "a-brand-new-password"); r.Status != http.StatusConflict || r.ErrorCode(t) != "ADMIN_EXISTS" {
		t.Fatalf("duplicate: %d %s", r.Status, r.Body)
	}
	if r := adminLogin(t, env.Anonymous(), "second@example.com", "a-brand-new-password"); r.Status != http.StatusOK {
		t.Fatalf("new admin login: %d %s", r.Status, r.Body)
	}
}

func TestGoogleLoginNeverGrantsAdmin(t *testing.T) {
	env := testutil.NewEnv(t)
	seedAdmin(t, env)
	role := googleLoginRole(t, env, adminEmail)
	if role != auth.RoleCustomer {
		t.Fatalf("google login with an admin's email produced role %q", role)
	}
}

func googleLoginRole(t *testing.T, env *testutil.Env, email string) string {
	t.Helper()
	ctx := context.Background()
	svc := auth.NewService(env.Pool, fakeGoogle{ident: google.Identity{Subject: "sub-admin", Email: email, EmailVerified: true}},
		auth.NewSessions(env.Pool, "gy_session", time.Hour, false), nil)
	state := "s" + uuid.NewString()
	if err := dbq.New(env.Pool).InsertOAuthState(ctx, dbq.InsertOAuthStateParams{State: state, CodeVerifier: "v", Nonce: "n", ReturnTo: "/", ExpiresAt: time.Now().Add(time.Hour)}); err != nil {
		t.Fatal(err)
	}
	res, err := svc.CompleteLogin(ctx, httptest.NewRecorder(), httptest.NewRequest("GET", "/", nil), state, "code")
	if err != nil {
		t.Fatal(err)
	}
	return res.User.Role
}
