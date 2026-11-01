package config

import (
	"encoding/base64"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Env        string
	HTTPAddr   string
	AppURL     *url.URL
	APIURL     *url.URL
	CORSOrigin []string

	DatabaseURL string

	SessionCookieName string
	SessionTTL        time.Duration
	CookieSecure      bool

	GoogleClientID     string
	GoogleClientSecret string

	IdentityKeys      map[string][]byte
	IdentityActiveKey string

	S3Endpoint       string
	S3Region         string
	S3AccessKey      string
	S3SecretKey      string
	S3UseSSL         bool
	S3PublicBucket   string
	S3PrivateBucket  string
	MediaPublicURL   string
	S3ForcePathStyle bool

	MidtransServerKey    string
	MidtransClientKey    string
	MidtransMerchantID   string
	MidtransProduction   bool
	MidtransSnapURL      string
	MidtransAPIURL       string
	MidtransWebhookToken string

	SMTPHost        string
	SMTPPort        int
	SMTPUsername    string
	SMTPPassword    string
	SMTPTLSMode     string
	MailFromAddress string
	MailFromName    string
	AdminNotifyTo   []string

	TurnstileSecret string

	MetricsAddr string
	TrustProxy  bool
}

func (c *Config) IsProduction() bool { return c.Env == "production" }

type loader struct {
	errs []string
}

func (l *loader) str(key string, required bool, def string) string {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		if required {
			l.errs = append(l.errs, key+" is required")
		}
		return def
	}
	return v
}

func (l *loader) integer(key string, def int) int {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		l.errs = append(l.errs, key+" must be an integer")
		return def
	}
	return n
}

func (l *loader) boolean(key string, def bool) bool {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return def
	}
	b, err := strconv.ParseBool(v)
	if err != nil {
		l.errs = append(l.errs, key+" must be a boolean")
		return def
	}
	return b
}

func (l *loader) url(key string, required bool) *url.URL {
	raw := l.str(key, required, "")
	if raw == "" {
		return &url.URL{}
	}
	u, err := url.Parse(raw)
	if err != nil || u.Scheme == "" || u.Host == "" {
		l.errs = append(l.errs, key+" must be an absolute URL")
		return &url.URL{}
	}
	return u
}

func list(raw string) []string {
	var out []string
	for _, p := range strings.Split(raw, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

// Load reads configuration from the environment and fails fast on anything missing or malformed.
// Optional integrations (Google, Midtrans, SMTP, Turnstile) may be empty in development; the
// features that need them report a clear error when used.
func Load() (*Config, error) {
	l := &loader{}
	c := &Config{}
	c.Env = l.str("APP_ENV", false, "development")
	if c.Env != "development" && c.Env != "production" && c.Env != "test" {
		l.errs = append(l.errs, "APP_ENV must be development, production or test")
	}
	prod := c.Env == "production"

	c.HTTPAddr = l.str("HTTP_ADDR", false, ":8080")
	c.MetricsAddr = l.str("METRICS_ADDR", false, ":9090")
	c.AppURL = l.url("APP_URL", true)
	c.APIURL = l.url("API_PUBLIC_URL", false)
	if c.APIURL.Host == "" {
		c.APIURL = c.AppURL
	}
	c.CORSOrigin = list(l.str("CORS_ALLOWED_ORIGINS", false, c.AppURL.String()))
	c.DatabaseURL = l.str("DATABASE_URL", true, "")
	c.TrustProxy = l.boolean("TRUST_PROXY", true)

	c.SessionCookieName = l.str("SESSION_COOKIE_NAME", false, "gy_session")
	c.SessionTTL = time.Duration(l.integer("SESSION_TTL_DAYS", 30)) * 24 * time.Hour
	c.CookieSecure = l.boolean("COOKIE_SECURE", prod)

	c.GoogleClientID = l.str("GOOGLE_CLIENT_ID", prod, "")
	c.GoogleClientSecret = l.str("GOOGLE_CLIENT_SECRET", prod, "")

	c.IdentityKeys = map[string][]byte{}
	for _, entry := range list(l.str("IDENTITY_ENCRYPTION_KEYS", true, "")) {
		id, b64, ok := strings.Cut(entry, ":")
		key, err := base64.StdEncoding.DecodeString(b64)
		if !ok || id == "" || err != nil || len(key) != 32 {
			l.errs = append(l.errs, "IDENTITY_ENCRYPTION_KEYS entries must be id:base64(32 bytes)")
			continue
		}
		c.IdentityKeys[id] = key
	}
	c.IdentityActiveKey = l.str("IDENTITY_ENCRYPTION_ACTIVE_KEY", true, "")
	if _, ok := c.IdentityKeys[c.IdentityActiveKey]; c.IdentityActiveKey != "" && !ok {
		l.errs = append(l.errs, "IDENTITY_ENCRYPTION_ACTIVE_KEY must name a key in IDENTITY_ENCRYPTION_KEYS")
	}

	c.S3Endpoint = l.str("S3_ENDPOINT", true, "")
	c.S3Region = l.str("S3_REGION", false, "us-east-1")
	c.S3AccessKey = l.str("S3_ACCESS_KEY", true, "")
	c.S3SecretKey = l.str("S3_SECRET_KEY", true, "")
	c.S3UseSSL = l.boolean("S3_USE_SSL", false)
	c.S3PublicBucket = l.str("S3_PUBLIC_BUCKET", false, "goyacht-public")
	c.S3PrivateBucket = l.str("S3_PRIVATE_BUCKET", false, "goyacht-private")
	c.MediaPublicURL = strings.TrimRight(l.str("MEDIA_PUBLIC_URL", true, ""), "/")

	c.MidtransServerKey = l.str("MIDTRANS_SERVER_KEY", prod, "")
	c.MidtransClientKey = l.str("MIDTRANS_CLIENT_KEY", prod, "")
	c.MidtransMerchantID = l.str("MIDTRANS_MERCHANT_ID", prod, "")
	c.MidtransProduction = l.boolean("MIDTRANS_PRODUCTION", false)
	if c.MidtransProduction {
		c.MidtransSnapURL = "https://app.midtrans.com/snap/v1/transactions"
		c.MidtransAPIURL = "https://api.midtrans.com"
	} else {
		c.MidtransSnapURL = "https://app.sandbox.midtrans.com/snap/v1/transactions"
		c.MidtransAPIURL = "https://api.sandbox.midtrans.com"
	}
	c.MidtransSnapURL = l.str("MIDTRANS_SNAP_URL", false, c.MidtransSnapURL)
	c.MidtransAPIURL = l.str("MIDTRANS_API_URL", false, c.MidtransAPIURL)

	c.SMTPHost = l.str("SMTP_HOST", prod, "")
	c.SMTPPort = l.integer("SMTP_PORT", 587)
	c.SMTPUsername = l.str("SMTP_USERNAME", false, "")
	c.SMTPPassword = l.str("SMTP_PASSWORD", false, "")
	c.SMTPTLSMode = l.str("SMTP_TLS_MODE", false, "starttls")
	if c.SMTPTLSMode != "none" && c.SMTPTLSMode != "starttls" && c.SMTPTLSMode != "tls" {
		l.errs = append(l.errs, "SMTP_TLS_MODE must be none, starttls or tls")
	}
	c.MailFromAddress = l.str("MAIL_FROM_ADDRESS", prod, "no-reply@localhost")
	c.MailFromName = l.str("MAIL_FROM_NAME", false, "GoYacht")
	c.AdminNotifyTo = list(l.str("ADMIN_NOTIFY_EMAILS", false, ""))

	c.TurnstileSecret = l.str("TURNSTILE_SECRET_KEY", prod, "")

	if prod && !c.CookieSecure {
		l.errs = append(l.errs, "COOKIE_SECURE must be true in production")
	}
	if len(l.errs) > 0 {
		return nil, fmt.Errorf("invalid configuration: %w", errors.New(strings.Join(l.errs, "; ")))
	}
	return c, nil
}
