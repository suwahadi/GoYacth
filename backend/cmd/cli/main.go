package main

import (
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

	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"
	"github.com/riverqueue/river/rivermigrate"

	"goyacht/db"
	"goyacht/internal/modules/auth"
	"goyacht/internal/modules/seed"
	pdb "goyacht/internal/platform/db"
)

const usage = `GoYacht maintenance CLI

Usage:
  cli migrate up|down|status    apply, roll back one, or show database migrations
  cli admin grant <email>       allowlist an email as ADMIN (bootstraps the first admin)
  cli seed reference            insert default policies, tax lines and payment method fees if absent
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
		if len(args) < 3 || args[1] != "grant" {
			return errors.New("usage: cli admin grant <email>")
		}
		pool, err := connect(ctx)
		if err != nil {
			return err
		}
		defer pool.Close()
		promoted, err := auth.GrantBootstrapAdmin(ctx, pool, args[2])
		if err != nil {
			return err
		}
		if promoted {
			fmt.Println("existing user promoted to ADMIN")
		} else {
			fmt.Println("email allowlisted; ADMIN is granted on first Google login")
		}
		return nil
	case "seed":
		if len(args) < 2 || args[1] != "reference" {
			return errors.New("usage: cli seed reference")
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
