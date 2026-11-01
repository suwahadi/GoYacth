package google

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"
)

const issuer = "https://accounts.google.com"

type Identity struct {
	Subject       string
	Email         string
	EmailVerified bool
	Name          string
	Picture       string
}

type Authenticator interface {
	AuthURL(state, codeVerifier, nonce string) (string, error)
	Exchange(ctx context.Context, code, codeVerifier, nonce string) (Identity, error)
}

var ErrNotConfigured = errors.New("google oauth is not configured")

// OIDC discovers Google's endpoints lazily so the API can start without network access to Google.
type OIDC struct {
	clientID     string
	clientSecret string
	redirectURL  string

	mu       sync.Mutex
	provider *oidc.Provider
}

func New(clientID, clientSecret, redirectURL string) *OIDC {
	return &OIDC{clientID: clientID, clientSecret: clientSecret, redirectURL: redirectURL}
}

func (g *OIDC) load(ctx context.Context) (*oidc.Provider, error) {
	if g.clientID == "" || g.clientSecret == "" {
		return nil, ErrNotConfigured
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.provider != nil {
		return g.provider, nil
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	p, err := oidc.NewProvider(ctx, issuer)
	if err != nil {
		return nil, fmt.Errorf("discover google oidc: %w", err)
	}
	g.provider = p
	return p, nil
}

func (g *OIDC) oauthConfig(p *oidc.Provider) *oauth2.Config {
	return &oauth2.Config{
		ClientID: g.clientID, ClientSecret: g.clientSecret, RedirectURL: g.redirectURL,
		Endpoint: p.Endpoint(), Scopes: []string{oidc.ScopeOpenID, "email", "profile"},
	}
}

func (g *OIDC) AuthURL(state, codeVerifier, nonce string) (string, error) {
	p, err := g.load(context.Background())
	if err != nil {
		return "", err
	}
	return g.oauthConfig(p).AuthCodeURL(state, oauth2.S256ChallengeOption(codeVerifier), oidc.Nonce(nonce),
		oauth2.SetAuthURLParam("prompt", "select_account")), nil
}

func (g *OIDC) Exchange(ctx context.Context, code, codeVerifier, nonce string) (Identity, error) {
	p, err := g.load(ctx)
	if err != nil {
		return Identity{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	tok, err := g.oauthConfig(p).Exchange(ctx, code, oauth2.VerifierOption(codeVerifier))
	if err != nil {
		return Identity{}, fmt.Errorf("exchange code: %w", err)
	}
	raw, ok := tok.Extra("id_token").(string)
	if !ok {
		return Identity{}, errors.New("missing id_token")
	}
	idt, err := p.Verifier(&oidc.Config{ClientID: g.clientID}).Verify(ctx, raw)
	if err != nil {
		return Identity{}, fmt.Errorf("verify id_token: %w", err)
	}
	if idt.Nonce != nonce {
		return Identity{}, errors.New("nonce mismatch")
	}
	var claims struct {
		Email         string `json:"email"`
		EmailVerified bool   `json:"email_verified"`
		Name          string `json:"name"`
		Picture       string `json:"picture"`
	}
	if err := idt.Claims(&claims); err != nil {
		return Identity{}, fmt.Errorf("decode claims: %w", err)
	}
	return Identity{Subject: idt.Subject, Email: claims.Email, EmailVerified: claims.EmailVerified, Name: claims.Name, Picture: claims.Picture}, nil
}
