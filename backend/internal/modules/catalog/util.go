package catalog

import (
	"net/http"
	"strconv"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"goyacht/internal/modules/audit"
	"goyacht/internal/modules/auth"
	"goyacht/internal/platform/db"
	"goyacht/internal/platform/db/dbq"
)

func withAuditGeneric(r *http.Request, pool *pgxpool.Pool, action, entityType string, fn func(tx pgx.Tx, q *dbq.Queries) (string, any, error)) error {
	actor := auth.UserIDPtr(auth.FromContext(r.Context()))
	return db.InTx(r.Context(), pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		id, after, err := fn(tx, q)
		if err != nil {
			return MapWriteError(err)
		}
		return audit.Record(r.Context(), q, audit.Entry{ActorID: actor, Action: action, EntityType: entityType, EntityID: id, After: after})
	})
}

func fmtInt(i int) string { return strconv.Itoa(i) }
