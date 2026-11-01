package idempotency

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"goyacht/internal/platform/db"
	"goyacht/internal/platform/db/dbq"
	"goyacht/internal/platform/httpx"
	"goyacht/internal/platform/secure"
)

var (
	ErrKeyRequired = httpx.BadRequest("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key header is required")
	ErrKeyReused   = httpx.Conflict("IDEMPOTENCY_KEY_REUSED", "Idempotency-Key was used with a different request")
)

type Result struct {
	Status int
	Body   []byte
}

func KeyFromRequest(r *http.Request) (string, error) {
	k := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if len(k) < 8 || len(k) > 128 {
		return "", ErrKeyRequired
	}
	return k, nil
}

// Do runs fn at most once per (scope, user, key). The key row is inserted in the same
// transaction as fn's writes, so a concurrent duplicate blocks on the unique index until the
// first request commits and then replays its stored response. Client errors are stored and
// replayed too; server errors roll everything back so the client may retry.
func Do(ctx context.Context, pool *pgxpool.Pool, scope string, userID *uuid.UUID, key string, request any,
	fn func(tx pgx.Tx) (int, any, error),
) (Result, error) {
	reqBytes, err := json.Marshal(request)
	if err != nil {
		return Result{}, fmt.Errorf("hash request: %w", err)
	}
	hash := secure.HashToken(string(reqBytes))

	var out Result
	err = db.InTx(ctx, pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		id, err := q.InsertIdempotencyKey(ctx, dbq.InsertIdempotencyKeyParams{Scope: scope, UserID: userID, Key: key, RequestHash: hash})
		if db.IsNoRows(err) {
			existing, err := q.GetIdempotencyKeyForUpdate(ctx, dbq.GetIdempotencyKeyForUpdateParams{Scope: scope, UserID: userID, Key: key})
			if err != nil {
				return fmt.Errorf("load idempotency key: %w", err)
			}
			if string(existing.RequestHash) != string(hash) {
				return ErrKeyReused
			}
			if existing.StatusCode == nil {
				return httpx.Conflict("IDEMPOTENCY_IN_PROGRESS", "request with this key is still in progress")
			}
			out = Result{Status: int(*existing.StatusCode), Body: existing.ResponseBody}
			return nil
		}
		if err != nil {
			return fmt.Errorf("insert idempotency key: %w", err)
		}

		sp, err := tx.Begin(ctx)
		if err != nil {
			return err
		}
		status, body, fnErr := fn(sp)
		if fnErr != nil {
			_ = sp.Rollback(ctx)
			appErr, ok := httpx.AsError(fnErr)
			if !ok || appErr.Status >= 500 || appErr.Status == http.StatusTooManyRequests {
				return fnErr
			}
			status = appErr.Status
			body = map[string]any{"error": map[string]any{"code": appErr.Code, "message": appErr.Message, "fields": appErr.Fields}}
		} else if err := sp.Commit(ctx); err != nil {
			return err
		}
		if fnErr == nil {
			body = map[string]any{"data": body}
		}
		raw, err := json.Marshal(body)
		if err != nil {
			return err
		}
		code := int32(status)
		if err := q.CompleteIdempotencyKey(ctx, dbq.CompleteIdempotencyKeyParams{ID: id, StatusCode: &code, ResponseBody: raw}); err != nil {
			return err
		}
		out = Result{Status: status, Body: raw}
		return nil
	})
	return out, err
}

func Write(w http.ResponseWriter, res Result) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(res.Status)
	_, _ = w.Write(res.Body)
}
