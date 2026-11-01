-- name: ListPagesAdmin :many
SELECT p.*, COALESCE((SELECT jsonb_object_agg(t.locale, to_jsonb(t) - 'page_id' - 'locale') FROM page_translations t WHERE t.page_id = p.id), '{}')::jsonb AS translations
FROM pages p ORDER BY p.created_at DESC;

-- name: GetPageAdmin :one
SELECT p.*, COALESCE((SELECT jsonb_object_agg(t.locale, to_jsonb(t) - 'page_id' - 'locale') FROM page_translations t WHERE t.page_id = p.id), '{}')::jsonb AS translations
FROM pages p WHERE p.id = $1;

-- name: InsertPage :one
INSERT INTO pages (status, published_at) VALUES ($1, $2) RETURNING *;

-- name: UpdatePage :one
UPDATE pages SET status = $2, published_at = $3, updated_at = now() WHERE id = $1 RETURNING *;

-- name: GetPageTranslation :one
SELECT * FROM page_translations WHERE page_id = $1 AND locale = $2;

-- name: UpsertPageTranslation :exec
INSERT INTO page_translations (page_id, locale, title, slug, blocks, seo_title, seo_description) VALUES ($1, $2, $3, $4, $5, $6, $7)
ON CONFLICT (page_id, locale) DO UPDATE SET title = EXCLUDED.title, slug = EXCLUDED.slug, blocks = EXCLUDED.blocks,
    seo_title = EXCLUDED.seo_title, seo_description = EXCLUDED.seo_description;

-- name: FindPageBySlug :one
SELECT page_id FROM page_translations WHERE locale = $1 AND slug = $2;

-- name: DeletePage :execrows
DELETE FROM pages WHERE id = $1;

-- name: ListSections :many
SELECT s.*, COALESCE((SELECT jsonb_object_agg(t.locale, t.content) FROM page_section_translations t WHERE t.section_id = s.id), '{}')::jsonb AS translations
FROM page_sections s ORDER BY s.sort_order, s.created_at;

-- name: InsertSection :one
INSERT INTO page_sections (type, sort_order, is_active, config) VALUES ($1, $2, $3, $4) RETURNING *;

-- name: UpdateSection :one
UPDATE page_sections SET type = $2, sort_order = $3, is_active = $4, config = $5, updated_at = now() WHERE id = $1 RETURNING *;

-- name: UpsertSectionTranslation :exec
INSERT INTO page_section_translations (section_id, locale, content) VALUES ($1, $2, $3)
ON CONFLICT (section_id, locale) DO UPDATE SET content = EXCLUDED.content;

-- name: DeleteSection :execrows
DELETE FROM page_sections WHERE id = $1;

-- name: ListFaqsAdmin :many
SELECT f.*, COALESCE((SELECT jsonb_object_agg(t.locale, jsonb_build_object('question', t.question, 'answer', t.answer)) FROM faq_translations t WHERE t.faq_id = f.id), '{}')::jsonb AS translations
FROM faqs f ORDER BY f.category, f.sort_order, f.created_at;

-- name: InsertFaq :one
INSERT INTO faqs (category, boat_id, package_id, sort_order, status) VALUES ($1, $2, $3, $4, $5) RETURNING *;

-- name: UpdateFaq :one
UPDATE faqs SET category = $2, boat_id = $3, package_id = $4, sort_order = $5, status = $6, updated_at = now() WHERE id = $1 RETURNING *;

-- name: UpsertFaqTranslation :exec
INSERT INTO faq_translations (faq_id, locale, question, answer) VALUES ($1, $2, $3, $4)
ON CONFLICT (faq_id, locale) DO UPDATE SET question = EXCLUDED.question, answer = EXCLUDED.answer;

-- name: DeleteFaq :execrows
DELETE FROM faqs WHERE id = $1;

-- name: ListFaqsPublic :many
SELECT f.id, f.category, f.boat_id, f.package_id, f.sort_order, t.question, t.answer
FROM faqs f
JOIN LATERAL (
    SELECT * FROM faq_translations ft WHERE ft.faq_id = f.id AND ft.locale IN (sqlc.arg(locale)::text, 'en')
    ORDER BY (ft.locale = sqlc.arg(locale)::text) DESC LIMIT 1
) t ON true
WHERE f.status = 'PUBLISHED'
  AND (sqlc.narg(boat_id)::uuid IS NULL OR f.boat_id = sqlc.narg(boat_id))
  AND (sqlc.narg(package_id)::uuid IS NULL OR f.package_id = sqlc.narg(package_id))
  AND (sqlc.narg(category)::text IS NULL OR f.category = sqlc.narg(category))
  AND (sqlc.arg(general_only)::bool = false OR (f.boat_id IS NULL AND f.package_id IS NULL))
ORDER BY f.category, f.sort_order
LIMIT 200;
