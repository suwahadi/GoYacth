package media

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"

	"goyacht/internal/integrations/storage"
	"goyacht/internal/modules/audit"
	"goyacht/internal/platform/db"
	"goyacht/internal/platform/db/dbq"
	"goyacht/internal/platform/httpx"
	"goyacht/internal/platform/i18n"
	"goyacht/internal/platform/jobs"
	"goyacht/internal/platform/secure"
)

var (
	ErrFileTooLarge  = httpx.Unprocessable("MEDIA_FILE_TOO_LARGE", "file exceeds 15 MB")
	ErrNotImage      = httpx.Unprocessable("MEDIA_UNSUPPORTED_TYPE", "only JPEG, PNG and WebP images are accepted")
	ErrDimensions    = httpx.Unprocessable("MEDIA_DIMENSIONS_TOO_LARGE", "image dimensions exceed the limit")
	ErrCorruptImage  = httpx.Unprocessable("MEDIA_CORRUPT", "image could not be decoded")
	ErrMediaNotReady = httpx.Unprocessable("MEDIA_NOT_READY", "media is not ready")
	ErrMediaNotFound = httpx.NotFound("MEDIA_NOT_FOUND")
)

type Service struct {
	pool    *pgxpool.Pool
	store   storage.Store
	enqueue jobs.Enqueuer
}

func NewService(pool *pgxpool.Pool, store storage.Store, enqueue jobs.Enqueuer) *Service {
	return &Service{pool: pool, store: store, enqueue: enqueue}
}

var slugChars = regexp.MustCompile(`[^a-z0-9]+`)

func Slugify(s string) string {
	s = slugChars.ReplaceAllString(strings.ToLower(strings.TrimSpace(s)), "-")
	s = strings.Trim(s, "-")
	if len(s) > 60 {
		s = strings.Trim(s[:60], "-")
	}
	return s
}

func incomingKey(baseName string) string { return "incoming/" + baseName }

type UploadInput struct {
	Data     []byte
	Slug     string
	Bucket   storage.Bucket
	AltTexts map[string]string
	ActorID  *uuid.UUID
}

func (s *Service) Upload(ctx context.Context, in UploadInput) (dbq.Medium, error) {
	if len(in.Data) > MaxUploadBytes {
		return dbq.Medium{}, ErrFileTooLarge
	}
	fields := httpx.FieldErrors{}
	if in.Bucket == storage.Public {
		for _, loc := range i18n.Supported {
			alt := strings.TrimSpace(in.AltTexts[loc])
			if alt == "" {
				fields.Add("alt_"+loc, "REQUIRED")
			} else if len(alt) > 250 {
				fields.Add("alt_"+loc, "TOO_LONG")
			}
		}
	}
	if err := fields.Err(); err != nil {
		return dbq.Medium{}, err
	}
	contentType, _, _, err := Inspect(in.Data)
	switch {
	case errors.Is(err, ErrUnsupportedType):
		return dbq.Medium{}, ErrNotImage
	case errors.Is(err, ErrTooLarge):
		return dbq.Medium{}, ErrDimensions
	case errors.Is(err, ErrCorrupt):
		return dbq.Medium{}, ErrCorruptImage
	case err != nil:
		return dbq.Medium{}, err
	}
	slug := Slugify(in.Slug)
	if slug == "" {
		slug = "image"
	}
	baseName := slug + "-" + strings.ToLower(secure.RandomCode(6, "0123456789abcdefghjkmnpqrstvwxyz"))

	if err := s.store.Put(ctx, storage.Private, incomingKey(baseName), in.Data, contentType); err != nil {
		return dbq.Medium{}, fmt.Errorf("store upload: %w", err)
	}
	deleteAfter := time.Now().Add(24 * time.Hour)
	var m dbq.Medium
	err = db.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		var err error
		m, err = q.InsertMedia(ctx, dbq.InsertMediaParams{
			Bucket: string(in.Bucket), BaseName: baseName, ContentType: "image/webp",
			UploadedBy: in.ActorID, ByteSize: int64(len(in.Data)), DeleteAfter: &deleteAfter,
		})
		if err != nil {
			return err
		}
		for loc, alt := range in.AltTexts {
			if !i18n.Valid(loc) || strings.TrimSpace(alt) == "" {
				continue
			}
			if err := q.UpsertMediaTranslation(ctx, dbq.UpsertMediaTranslationParams{MediaID: m.ID, Locale: loc, AltText: strings.TrimSpace(alt)}); err != nil {
				return err
			}
		}
		return s.enqueue.EnqueueTx(ctx, tx, jobs.ProcessMedia{MediaID: m.ID, Slug: slug})
	})
	if err != nil {
		if delErr := s.store.Delete(context.WithoutCancel(ctx), storage.Private, incomingKey(baseName)); delErr != nil {
			slog.WarnContext(ctx, "remove incoming upload after failed insert", "error", delErr)
		}
		return dbq.Medium{}, err
	}
	return m, nil
}

// Process converts an uploaded image. Variants are written before the row is marked READY, and
// object names are never reused, so a crash midway leaves only unreferenced objects behind.
func (s *Service) Process(ctx context.Context, mediaID uuid.UUID) error {
	q := dbq.New(s.pool)
	m, err := q.GetMedia(ctx, mediaID)
	if err != nil {
		if db.IsNoRows(err) {
			return river.JobCancel(fmt.Errorf("media %s not found", mediaID))
		}
		return err
	}
	if m.Status != "PROCESSING" {
		return nil
	}
	raw, err := s.store.Get(ctx, storage.Private, incomingKey(m.BaseName))
	if err != nil {
		return fmt.Errorf("read incoming: %w", err)
	}
	w, h, variants, err := Convert(raw, m.BaseName)
	if err != nil {
		if errors.Is(err, ErrCorrupt) || errors.Is(err, ErrTooLarge) {
			if mErr := q.MarkMediaFailed(ctx, dbq.MarkMediaFailedParams{ID: m.ID, FailureReason: err.Error()}); mErr != nil {
				return mErr
			}
			_ = s.store.Delete(ctx, storage.Private, incomingKey(m.BaseName))
			return river.JobCancel(err)
		}
		return err
	}
	bucket := storage.Bucket(m.Bucket)
	meta := make([]Variant, 0, len(variants))
	for _, v := range variants {
		if err := s.store.Put(ctx, bucket, v.Key, v.data, "image/webp"); err != nil {
			return fmt.Errorf("store variant: %w", err)
		}
		meta = append(meta, v.Variant)
	}
	raw2, _ := json.Marshal(meta)
	w32, h32 := int32(w), int32(h)
	if err := q.MarkMediaReady(ctx, dbq.MarkMediaReadyParams{ID: m.ID, Width: &w32, Height: &h32, Variants: raw2}); err != nil {
		return err
	}
	if err := s.store.Delete(ctx, storage.Private, incomingKey(m.BaseName)); err != nil {
		slog.WarnContext(ctx, "remove incoming after processing", "error", err, "media_id", m.ID)
	}
	return nil
}

// SetUsages replaces the media attached to (entityType, entityID, role) inside the caller's
// transaction. Media no longer referenced anywhere is scheduled for deletion by a job enqueued in
// the same transaction, so files disappear only if the database change commits.
func (s *Service) SetUsages(ctx context.Context, tx pgx.Tx, entityType string, entityID uuid.UUID, role string, mediaIDs []uuid.UUID) error {
	q := dbq.New(tx)
	if len(mediaIDs) > 0 {
		rows, err := q.ListMediaByIDs(ctx, mediaIDs)
		if err != nil {
			return err
		}
		if len(rows) != len(uniq(mediaIDs)) {
			return ErrMediaNotFound
		}
		for _, r := range rows {
			if r.Status == "FAILED" || r.Status == "DELETED" || r.Bucket != string(storage.Public) {
				return ErrMediaNotReady
			}
		}
	}
	removed, err := q.DeleteMediaUsagesForRole(ctx, dbq.DeleteMediaUsagesForRoleParams{EntityType: entityType, EntityID: entityID, Role: role})
	if err != nil {
		return err
	}
	for i, id := range mediaIDs {
		if err := q.InsertMediaUsage(ctx, dbq.InsertMediaUsageParams{MediaID: id, EntityType: entityType, EntityID: entityID, Role: role, SortOrder: int32(i)}); err != nil {
			return err
		}
	}
	if len(mediaIDs) > 0 {
		if err := q.ClearMediaDeleteAfter(ctx, mediaIDs); err != nil {
			return err
		}
	}
	return s.scheduleRemoval(ctx, tx, removed, mediaIDs)
}

func (s *Service) RemoveEntity(ctx context.Context, tx pgx.Tx, entityType string, entityID uuid.UUID) error {
	removed, err := dbq.New(tx).DeleteMediaUsagesForEntity(ctx, dbq.DeleteMediaUsagesForEntityParams{EntityType: entityType, EntityID: entityID})
	if err != nil {
		return err
	}
	return s.scheduleRemoval(ctx, tx, removed, nil)
}

func (s *Service) scheduleRemoval(ctx context.Context, tx pgx.Tx, removed, kept []uuid.UUID) error {
	var gone []uuid.UUID
	for _, id := range uniq(removed) {
		if !containsID(kept, id) {
			gone = append(gone, id)
		}
	}
	if len(gone) == 0 {
		return nil
	}
	if err := dbq.New(tx).ScheduleMediaDeletion(ctx, gone); err != nil {
		return err
	}
	return s.enqueue.EnqueueTx(ctx, tx, jobs.DeleteMedia{MediaIDs: gone})
}

// DeleteUnused removes objects for media that nothing references any more. The reference check
// and the DELETED mark happen under a row lock so a concurrent re-attach cannot lose its file.
func (s *Service) DeleteUnused(ctx context.Context, ids []uuid.UUID) error {
	for _, id := range ids {
		var target *dbq.Medium
		err := db.InTx(ctx, s.pool, func(tx pgx.Tx) error {
			var mid uuid.UUID
			if err := tx.QueryRow(ctx, `SELECT id FROM media WHERE id = $1 AND status <> 'DELETED' FOR UPDATE`, id).Scan(&mid); err != nil {
				if db.IsNoRows(err) {
					return nil
				}
				return err
			}
			var referenced bool
			if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM media_usages WHERE media_id = $1)
				OR EXISTS (SELECT 1 FROM payments WHERE proof_media_id = $1)
				OR EXISTS (SELECT 1 FROM refunds WHERE proof_media_id = $1)
				OR EXISTS (SELECT 1 FROM payouts WHERE proof_media_id = $1)`, id).Scan(&referenced); err != nil {
				return err
			}
			if referenced {
				return dbq.New(tx).ClearMediaDeleteAfter(ctx, []uuid.UUID{id})
			}
			m, err := dbq.New(tx).GetMedia(ctx, id)
			if err != nil {
				return err
			}
			target = &m
			return dbq.New(tx).MarkMediaDeleted(ctx, id)
		})
		if err != nil {
			return err
		}
		if target != nil {
			s.deleteObjects(ctx, *target)
		}
	}
	return nil
}

func (s *Service) deleteObjects(ctx context.Context, m dbq.Medium) {
	var variants []Variant
	_ = json.Unmarshal(m.Variants, &variants)
	for _, v := range variants {
		if err := s.store.Delete(ctx, storage.Bucket(m.Bucket), v.Key); err != nil {
			slog.WarnContext(ctx, "delete media object", "error", err, "key", v.Key)
		}
	}
	_ = s.store.Delete(ctx, storage.Private, incomingKey(m.BaseName))
}

func (s *Service) CleanupOrphans(ctx context.Context) error {
	rows, err := dbq.New(s.pool).ListOrphanMedia(ctx)
	if err != nil {
		return err
	}
	ids := make([]uuid.UUID, 0, len(rows))
	for _, r := range rows {
		ids = append(ids, r.ID)
	}
	return s.DeleteUnused(ctx, ids)
}

// UpdateAltText sets alt texts per locale. The default locale cannot be blank; other locales can
// be cleared, which falls back to the default on public pages.
func (s *Service) UpdateAltText(ctx context.Context, actor *uuid.UUID, id uuid.UUID, alts map[string]string) error {
	f := httpx.FieldErrors{}
	for loc, alt := range alts {
		alt = strings.TrimSpace(alt)
		switch {
		case !i18n.Valid(loc):
			f.Add("alt_texts."+loc, "INVALID_LOCALE")
		case len(alt) > 250:
			f.Add("alt_texts."+loc, "TOO_LONG")
		case alt == "" && loc == i18n.Default:
			f.Add("alt_texts."+loc, "REQUIRED")
		}
	}
	if err := f.Err(); err != nil {
		return err
	}
	return db.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		m, err := q.GetMedia(ctx, id)
		if err != nil {
			if db.IsNoRows(err) {
				return ErrMediaNotFound
			}
			return err
		}
		for loc, alt := range alts {
			alt = strings.TrimSpace(alt)
			if alt == "" {
				if m.Bucket == string(storage.Public) && loc == i18n.Default {
					continue
				}
				if err := q.DeleteMediaTranslation(ctx, dbq.DeleteMediaTranslationParams{MediaID: id, Locale: loc}); err != nil {
					return err
				}
				continue
			}
			if err := q.UpsertMediaTranslation(ctx, dbq.UpsertMediaTranslationParams{MediaID: id, Locale: loc, AltText: alt}); err != nil {
				return err
			}
		}
		return audit.Record(ctx, q, audit.Entry{ActorID: actor, Action: "media.alt_updated", EntityType: "media", EntityID: id.String(), After: alts})
	})
}

func uniq(ids []uuid.UUID) []uuid.UUID {
	seen := map[uuid.UUID]bool{}
	out := ids[:0:0]
	for _, id := range ids {
		if !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	return out
}

func containsID(ids []uuid.UUID, id uuid.UUID) bool {
	for _, x := range ids {
		if x == id {
			return true
		}
	}
	return false
}
