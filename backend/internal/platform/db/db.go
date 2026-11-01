package db

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

func Connect(ctx context.Context, url string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, fmt.Errorf("parse database url: %w", err)
	}
	cfg.MaxConnLifetime = time.Hour
	cfg.MaxConnIdleTime = 10 * time.Minute
	cfg.ConnConfig.RuntimeParams["timezone"] = "UTC"
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("create pool: %w", err)
	}
	pingCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping database: %w", err)
	}
	return pool, nil
}

// InTx runs fn inside a transaction and commits only if fn returns nil.
func InTx(ctx context.Context, pool *pgxpool.Pool, fn func(pgx.Tx) error) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	if err := fn(tx); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit tx: %w", err)
	}
	return nil
}

const (
	codeUniqueViolation    = "23505"
	codeExclusionViolation = "23P01"
	codeForeignKey         = "23503"
	codeCheckViolation     = "23514"
)

func pgCode(err error) (string, string) {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code, pgErr.ConstraintName
	}
	return "", ""
}

func IsUniqueViolation(err error) bool {
	c, _ := pgCode(err)
	return c == codeUniqueViolation
}

func UniqueConstraint(err error) string {
	c, name := pgCode(err)
	if c != codeUniqueViolation {
		return ""
	}
	return name
}

func IsExclusionViolation(err error) bool {
	c, _ := pgCode(err)
	return c == codeExclusionViolation
}

func IsForeignKeyViolation(err error) bool {
	c, _ := pgCode(err)
	return c == codeForeignKey
}

func IsCheckViolation(err error) bool {
	c, _ := pgCode(err)
	return c == codeCheckViolation
}

func IsNoRows(err error) bool {
	return errors.Is(err, pgx.ErrNoRows)
}
