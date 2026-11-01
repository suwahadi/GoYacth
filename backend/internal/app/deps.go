package app

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"

	"goyacht/internal/integrations/storage"
	"goyacht/internal/platform/config"
	"goyacht/internal/platform/db"
	"goyacht/internal/platform/i18n"
	"goyacht/internal/platform/jobs"
	"goyacht/internal/platform/secure"
	"goyacht/locales"
)

// Deps holds the shared infrastructure built once per process.
type Deps struct {
	Config   *config.Config
	Pool     *pgxpool.Pool
	Store    *storage.S3
	Cipher   *secure.Cipher
	Messages *i18n.Messages
	River    *river.Client[pgx.Tx]
	enqueuer *jobs.RiverEnqueuer
}

func (d *Deps) Enqueuer() jobs.Enqueuer { return d.enqueuer }

func NewDeps(ctx context.Context, cfg *config.Config) (*Deps, error) {
	pool, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		return nil, err
	}
	store, err := storage.NewS3(storage.Options{
		Endpoint: cfg.S3Endpoint, Region: cfg.S3Region, AccessKey: cfg.S3AccessKey, SecretKey: cfg.S3SecretKey,
		UseSSL: cfg.S3UseSSL, PublicBucket: cfg.S3PublicBucket, PrivateBucket: cfg.S3PrivateBucket, PublicBaseURL: cfg.MediaPublicURL,
	})
	if err != nil {
		pool.Close()
		return nil, err
	}
	cipher, err := secure.NewCipher(cfg.IdentityKeys, cfg.IdentityActiveKey)
	if err != nil {
		pool.Close()
		return nil, fmt.Errorf("identity cipher: %w", err)
	}
	msgs, err := i18n.Load(locales.FS, ".")
	if err != nil {
		pool.Close()
		return nil, fmt.Errorf("load locales: %w", err)
	}
	return &Deps{Config: cfg, Pool: pool, Store: store, Cipher: cipher, Messages: msgs, enqueuer: &jobs.RiverEnqueuer{}}, nil
}

// StartRiver creates the River client. An insert-only client (nil workers) is used by the API;
// the worker passes its worker set and periodic jobs.
func (d *Deps) StartRiver(riverCfg *river.Config) error {
	if riverCfg == nil {
		riverCfg = &river.Config{}
	}
	if riverCfg.Logger == nil {
		riverCfg.Logger = slog.Default()
	}
	rc, err := river.NewClient(riverpgxv5.New(d.Pool), riverCfg)
	if err != nil {
		return fmt.Errorf("river client: %w", err)
	}
	d.River = rc
	d.enqueuer.SetClient(rc)
	return nil
}

func (d *Deps) Close() {
	d.Pool.Close()
}
