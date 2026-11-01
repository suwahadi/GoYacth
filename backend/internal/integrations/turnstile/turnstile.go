package turnstile

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const verifyURL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"

// Verifier checks Cloudflare Turnstile tokens. Without a secret (local development) every
// token passes so the tracking form stays usable; production config requires the secret.
type Verifier struct {
	secret string
	http   *http.Client
}

func New(secret string) *Verifier {
	return &Verifier{secret: secret, http: &http.Client{Timeout: 8 * time.Second}}
}

func (v *Verifier) Verify(ctx context.Context, token, ip string) bool {
	if v.secret == "" {
		return true
	}
	if token == "" || len(token) > 4096 {
		return false
	}
	form := url.Values{"secret": {v.secret}, "response": {token}, "remoteip": {ip}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, verifyURL, strings.NewReader(form.Encode()))
	if err != nil {
		return false
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	res, err := v.http.Do(req)
	if err != nil {
		slog.WarnContext(ctx, "turnstile verify", "error", err)
		return false
	}
	defer res.Body.Close()
	var out struct {
		Success bool `json:"success"`
	}
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		return false
	}
	return out.Success
}
