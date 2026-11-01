package audit

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"

	"goyacht/internal/platform/db/dbq"
	"goyacht/internal/platform/httpx"
)

type Entry struct {
	ActorID    *uuid.UUID
	Action     string
	EntityType string
	EntityID   string
	Before     any
	After      any
}

func marshal(v any) (json.RawMessage, error) {
	if v == nil {
		return nil, nil
	}
	return json.Marshal(v)
}

// Record writes an audit entry using the caller's transaction so the log and the change commit
// or roll back together.
func Record(ctx context.Context, q *dbq.Queries, e Entry) error {
	before, err := marshal(e.Before)
	if err != nil {
		return fmt.Errorf("audit before: %w", err)
	}
	after, err := marshal(e.After)
	if err != nil {
		return fmt.Errorf("audit after: %w", err)
	}
	return q.InsertAuditLog(ctx, dbq.InsertAuditLogParams{
		ActorID:    e.ActorID,
		Action:     e.Action,
		EntityType: e.EntityType,
		EntityID:   e.EntityID,
		Before:     before,
		After:      after,
		RequestID:  httpx.RequestID(ctx),
		IpAddress:  httpx.ClientIP(ctx),
	})
}
