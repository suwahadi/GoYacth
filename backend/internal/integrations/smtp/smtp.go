package smtp

import (
	"context"
	"errors"
	"fmt"
	"time"

	mail "github.com/wneessen/go-mail"
)

type Message struct {
	To        string
	Subject   string
	Text      string
	HTML      string
	MessageID string
}

type Sender interface {
	Send(ctx context.Context, m Message) error
}

type Config struct {
	Host, Username, Password, TLSMode, FromAddress, FromName string
	Port                                                     int
}

// Client sends through any SMTP provider configured in the environment.
type Client struct {
	cfg Config
}

func New(cfg Config) *Client { return &Client{cfg: cfg} }

var ErrNotConfigured = errors.New("smtp is not configured")

func (c *Client) Send(ctx context.Context, m Message) error {
	if c.cfg.Host == "" {
		return ErrNotConfigured
	}
	opts := []mail.Option{mail.WithPort(c.cfg.Port), mail.WithTimeout(20 * time.Second)}
	switch c.cfg.TLSMode {
	case "tls":
		opts = append(opts, mail.WithSSL())
	case "starttls":
		opts = append(opts, mail.WithTLSPolicy(mail.TLSMandatory))
	default:
		opts = append(opts, mail.WithTLSPolicy(mail.NoTLS))
	}
	if c.cfg.Username != "" {
		opts = append(opts, mail.WithSMTPAuth(mail.SMTPAuthAutoDiscover), mail.WithUsername(c.cfg.Username), mail.WithPassword(c.cfg.Password))
	}
	client, err := mail.NewClient(c.cfg.Host, opts...)
	if err != nil {
		return fmt.Errorf("smtp client: %w", err)
	}
	msg := mail.NewMsg()
	if err := msg.FromFormat(c.cfg.FromName, c.cfg.FromAddress); err != nil {
		return err
	}
	if err := msg.To(m.To); err != nil {
		return err
	}
	msg.Subject(m.Subject)
	if m.MessageID != "" {
		msg.SetMessageIDWithValue(m.MessageID)
	}
	msg.SetBodyString(mail.TypeTextPlain, m.Text)
	msg.AddAlternativeString(mail.TypeTextHTML, m.HTML)
	return client.DialAndSendWithContext(ctx, msg)
}
