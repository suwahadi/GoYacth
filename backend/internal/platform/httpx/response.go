package httpx

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
)

type envelope struct {
	Data any `json:"data"`
	Meta any `json:"meta,omitempty"`
}

type errorBody struct {
	Code    string            `json:"code"`
	Message string            `json:"message"`
	Fields  map[string]string `json:"fields,omitempty"`
}

func JSON(w http.ResponseWriter, status int, data any) {
	write(w, status, envelope{Data: data})
}

func JSONMeta(w http.ResponseWriter, status int, data, meta any) {
	write(w, status, envelope{Data: data, Meta: meta})
}

func NoContent(w http.ResponseWriter) {
	w.WriteHeader(http.StatusNoContent)
}

func write(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

// WriteError maps any error to the public error envelope. Unknown errors are logged once here
// with the request ID and reported to the client as INTERNAL_ERROR without details.
func WriteError(w http.ResponseWriter, r *http.Request, err error) {
	e, ok := AsError(err)
	if !ok || e.Status >= 500 {
		slog.ErrorContext(r.Context(), "request failed", "error", err, "method", r.Method, "path", r.URL.Path)
		if !ok {
			e = ErrInternal
		}
	}
	if e.Status == http.StatusTooManyRequests {
		w.Header().Set("Retry-After", "60")
	}
	write(w, e.Status, map[string]any{"error": errorBody{Code: e.Code, Message: e.Message, Fields: e.Fields}})
}

const maxJSONBody = 1 << 20

// Decode reads a JSON body into dst, rejecting unknown fields so clients cannot smuggle values
// such as prices or statuses into DTOs.
func Decode(w http.ResponseWriter, r *http.Request, dst any) error {
	if ct := r.Header.Get("Content-Type"); ct != "" && !strings.HasPrefix(ct, "application/json") {
		return BadRequest("UNSUPPORTED_MEDIA_TYPE", "expected application/json")
	}
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxJSONBody))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		var mbe *http.MaxBytesError
		if errors.As(err, &mbe) {
			return ErrBodyTooLarge
		}
		var ute *json.UnmarshalTypeError
		if errors.As(err, &ute) {
			return Validation(map[string]string{ute.Field: "INVALID_TYPE"})
		}
		if strings.HasPrefix(err.Error(), "json: unknown field ") {
			field := strings.Trim(strings.TrimPrefix(err.Error(), "json: unknown field "), `"`)
			return Validation(map[string]string{field: "UNKNOWN_FIELD"})
		}
		return ErrInvalidJSON
	}
	if dec.More() {
		return ErrInvalidJSON
	}
	if _, err := dec.Token(); err != io.EOF {
		return ErrInvalidJSON
	}
	return nil
}

type Page struct {
	Page    int `json:"page"`
	PerPage int `json:"per_page"`
	Total   int `json:"total"`
}

func (p Page) Offset() int { return (p.Page - 1) * p.PerPage }

func ParsePage(r *http.Request, defPer, maxPer int) Page {
	q := r.URL.Query()
	page, _ := strconv.Atoi(q.Get("page"))
	per, _ := strconv.Atoi(q.Get("per_page"))
	if page < 1 {
		page = 1
	}
	if per < 1 {
		per = defPer
	}
	if per > maxPer {
		per = maxPer
	}
	return Page{Page: page, PerPage: per}
}

// ParseSort accepts "field" or "-field" and only returns fields present in the whitelist.
func ParseSort(r *http.Request, allowed map[string]string, def string) string {
	raw := r.URL.Query().Get("sort")
	desc := strings.HasPrefix(raw, "-")
	col, ok := allowed[strings.TrimPrefix(raw, "-")]
	if !ok {
		return def
	}
	if desc {
		return col + " DESC"
	}
	return col + " ASC"
}
