package main

import (
	"bufio"
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/davidbyttow/govips/v2/vips"
	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"
	"github.com/riverqueue/river/rivermigrate"

	"goyacht/db"
	"goyacht/internal/integrations/storage"
	"goyacht/internal/modules/auth"
	"goyacht/internal/modules/seed"
	"goyacht/internal/platform/config"
	pdb "goyacht/internal/platform/db"
)

const usage = `GoYacht maintenance CLI

Usage:
  cli migrate up|down|status    apply, roll back one, or show database migrations
  cli admin create <email> [name]   create an admin; reads the password from ADMIN_PASSWORD or stdin
  cli admin password <email>        reset an admin's password the same way and end their sessions
  cli seed reference            insert default policies, tax lines and payment method fees if absent
  cli seed demo                 fill a development database with a sample catalog (refused in production)
  cli keygen                    print a new identity encryption key (id:base64)
  cli health <url>              exit 0 when the URL answers 2xx (container health checks)

Environment: DATABASE_URL`

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	if len(args) == 0 {
		fmt.Println(usage)
		return nil
	}
	ctx := context.Background()
	switch args[0] {
	case "health":
		if len(args) < 2 {
			return errors.New("usage: cli health <url>")
		}
		client := &http.Client{Timeout: 3 * time.Second}
		res, err := client.Get(args[1])
		if err != nil {
			return err
		}
		_ = res.Body.Close()
		if res.StatusCode < 200 || res.StatusCode > 299 {
			return fmt.Errorf("health check returned %d", res.StatusCode)
		}
		return nil
	case "keygen":
		key := make([]byte, 32)
		if _, err := rand.Read(key); err != nil {
			return err
		}
		id := make([]byte, 4)
		_, _ = rand.Read(id)
		fmt.Printf("k%x:%s\n", id, base64.StdEncoding.EncodeToString(key))
		return nil
	case "migrate":
		if len(args) < 2 {
			return errors.New("migrate needs up, down or status")
		}
		return migrate(ctx, args[1])
	case "admin":
		if len(args) < 3 || (args[1] != "create" && args[1] != "password") {
			return errors.New("usage: cli admin create|password <email> [name]")
		}
		password, err := readPassword()
		if err != nil {
			return err
		}
		pool, err := connect(ctx)
		if err != nil {
			return err
		}
		defer pool.Close()
		if args[1] == "password" {
			if err := auth.ResetAdminPassword(ctx, pool, args[2], password); err != nil {
				return err
			}
			fmt.Println("password changed; existing sessions ended")
			return nil
		}
		name := strings.Join(args[3:], " ")
		if err := auth.CreateAdmin(ctx, pool, args[2], name, password, nil); err != nil {
			return err
		}
		fmt.Println("admin created; sign in at /admin/login")
		return nil
	case "seed":
		if len(args) == 2 && args[1] == "demo" {
			return seedDemo(ctx)
		}
		if len(args) < 2 || args[1] != "reference" {
			return errors.New("usage: cli seed reference|demo")
		}
		pool, err := connect(ctx)
		if err != nil {
			return err
		}
		defer pool.Close()
		return seed.Reference(ctx, pool)
	default:
		fmt.Println(usage)
		return fmt.Errorf("unknown command %q", args[0])
	}
}

func seedDemo(ctx context.Context) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	if cfg.IsProduction() {
		return seed.ErrDemoInProduction
	}
	pool, err := connect(ctx)
	if err != nil {
		return err
	}
	defer pool.Close()
	store, err := storage.NewS3(storage.Options{
		Endpoint: cfg.S3Endpoint, Region: cfg.S3Region, AccessKey: cfg.S3AccessKey, SecretKey: cfg.S3SecretKey,
		UseSSL: cfg.S3UseSSL, PublicBucket: cfg.S3PublicBucket, PrivateBucket: cfg.S3PrivateBucket, PublicBaseURL: cfg.MediaPublicURL,
	})
	if err != nil {
		return err
	}
	if err := store.EnsureBuckets(ctx); err != nil {
		return err
	}
	vips.LoggingSettings(nil, vips.LogLevelWarning)
	if err := vips.Startup(nil); err != nil {
		return err
	}
	defer vips.Shutdown()
	seeded, err := seed.Demo(ctx, cfg, pool, store, seed.UnsplashPhotos(&http.Client{Timeout: time.Minute}))
	if err != nil {
		return err
	}
	if seeded {
		fmt.Println("demo data inserted")
	} else {
		fmt.Println("demo data already present")
	}
	fmt.Printf("demo admin: %s / %s at /admin/login\n", seed.DemoAdminEmail, seed.DemoAdminPassword)
	return nil
}

// readPassword avoids a command-line argument, which would land in shell history and process lists.
func readPassword() (string, error) {
	if p := os.Getenv("ADMIN_PASSWORD"); p != "" {
		return p, nil
	}
	line, err := bufio.NewReader(os.Stdin).ReadString('\n')
	if err != nil && line == "" {
		return "", errors.New("set ADMIN_PASSWORD or pipe the password on stdin")
	}
	return strings.TrimRight(line, "\r\n"), nil
}

func databaseURL() (string, error) {
	u := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if u == "" {
		return "", errors.New("DATABASE_URL is required")
	}
	return u, nil
}

func connect(ctx context.Context) (*pgxpool.Pool, error) {
	u, err := databaseURL()
	if err != nil {
		return nil, err
	}
	return pdb.Connect(ctx, u)
}

// migrate runs River's own schema migrations alongside the application migrations so the job
// tables always match the River version compiled into the binary.
func migrate(ctx context.Context, direction string) error {
	u, err := databaseURL()
	if err != nil {
		return err
	}
	sqlDB, err := sql.Open("pgx", u)
	if err != nil {
		return err
	}
	defer func() { _ = sqlDB.Close() }()
	migrations, err := fs.Sub(db.Migrations, "migrations")
	if err != nil {
		return err
	}
	provider, err := goose.NewProvider(goose.DialectPostgres, sqlDB, migrations)
	if err != nil {
		return err
	}
	pool, err := connect(ctx)
	if err != nil {
		return err
	}
	defer pool.Close()
	riverMigrator, err := rivermigrate.New(riverpgxv5.New(pool), nil)
	if err != nil {
		return err
	}

	switch direction {
	case "up":
		res, err := provider.Up(ctx)
		for _, r := range res {
			fmt.Println("applied", r.Source.Path)
		}
		if err != nil {
			return err
		}
		rr, err := riverMigrator.Migrate(ctx, rivermigrate.DirectionUp, nil)
		if err != nil {
			return fmt.Errorf("river migrate: %w", err)
		}
		for _, v := range rr.Versions {
			fmt.Println("applied river migration", v.Version)
		}
		return nil
	case "down":
		r, err := provider.Down(ctx)
		if r != nil {
			fmt.Println("rolled back", r.Source.Path)
		}
		return err
	case "status":
		st, err := provider.Status(ctx)
		if err != nil {
			return err
		}
		for _, s := range st {
			fmt.Printf("%-40s %s\n", s.Source.Path, s.State)
		}
		return nil
	default:
		return fmt.Errorf("unknown migrate direction %q", direction)
	}
}
