package httpx

import (
	"errors"
	"fmt"
	"net/http"
)

// Error is the single error type that crosses the service/handler boundary. Code is stable and
// translated by the frontend; Message is an English developer hint.
type Error struct {
	Status  int
	Code    string
	Message string
	Fields  map[string]string
	cause   error
}

func (e *Error) Error() string {
	if e.cause != nil {
		return fmt.Sprintf("%s: %s: %v", e.Code, e.Message, e.cause)
	}
	return e.Code + ": " + e.Message
}

func (e *Error) Unwrap() error { return e.cause }

func NewError(status int, code, message string) *Error {
	return &Error{Status: status, Code: code, Message: message}
}

func (e *Error) WithFields(fields map[string]string) *Error {
	c := *e
	c.Fields = fields
	return &c
}

func (e *Error) Wrap(err error) *Error {
	c := *e
	c.cause = err
	return &c
}

func Validation(fields map[string]string) *Error {
	return &Error{Status: http.StatusUnprocessableEntity, Code: "VALIDATION_FAILED", Message: "input validation failed", Fields: fields}
}

func BadRequest(code, message string) *Error {
	return NewError(http.StatusBadRequest, code, message)
}

func NotFound(code string) *Error {
	return NewError(http.StatusNotFound, code, "resource not found")
}

func Conflict(code, message string) *Error {
	return NewError(http.StatusConflict, code, message)
}

func Unprocessable(code, message string) *Error {
	return NewError(http.StatusUnprocessableEntity, code, message)
}

var (
	ErrUnauthenticated = NewError(http.StatusUnauthorized, "UNAUTHENTICATED", "authentication required")
	ErrForbidden       = NewError(http.StatusForbidden, "FORBIDDEN", "not allowed")
	ErrNotFound        = NotFound("NOT_FOUND")
	ErrRateLimited     = NewError(http.StatusTooManyRequests, "RATE_LIMITED", "too many requests")
	ErrInternal        = NewError(http.StatusInternalServerError, "INTERNAL_ERROR", "internal server error")
	ErrCSRF            = NewError(http.StatusForbidden, "CSRF_INVALID", "missing or invalid CSRF token")
	ErrBodyTooLarge    = NewError(http.StatusRequestEntityTooLarge, "BODY_TOO_LARGE", "request body too large")
	ErrInvalidJSON     = BadRequest("INVALID_JSON", "request body is not valid JSON")
)

func AsError(err error) (*Error, bool) {
	var e *Error
	if errors.As(err, &e) {
		return e, true
	}
	return nil, false
}

type FieldErrors map[string]string

func (f FieldErrors) Add(field, code string) {
	if _, exists := f[field]; !exists {
		f[field] = code
	}
}

func (f FieldErrors) Err() error {
	if len(f) == 0 {
		return nil
	}
	return Validation(f)
}
