package apperror

import (
	"errors"
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/go-playground/validator/v10"
)

type Error struct {
	Code       string         `json:"code"`
	Message    string         `json:"message"`
	HTTPStatus int            `json:"-"`
	Details    map[string]any `json:"details,omitempty"`
}

func (e *Error) Error() string { return fmt.Sprintf("%s: %s", e.Code, e.Message) }

// Is reports whether target is an *Error with the same Code. This lets
// `errors.Is(clone, sentinel)` succeed after WithMessage / WithDetails, which
// return new *Error values rather than mutating the package-level sentinels.
func (e *Error) Is(target error) bool {
	var other *Error
	if !errors.As(target, &other) {
		return false
	}
	return e.Code == other.Code
}

func (e *Error) WithDetails(d map[string]any) *Error {
	clone := *e
	clone.Details = d
	return &clone
}

func (e *Error) WithMessage(msg string) *Error {
	clone := *e
	clone.Message = msg
	return &clone
}

// Sentinel errors. Repositories and services return these (often wrapped via fmt.Errorf("...: %w", err))
// and the HTTP layer maps them to status codes via Write().
var (
	ErrNotFound      = &Error{Code: "not_found", Message: "resource not found", HTTPStatus: http.StatusNotFound}
	ErrConflict      = &Error{Code: "conflict", Message: "resource already exists", HTTPStatus: http.StatusConflict}
	ErrUnauthorized  = &Error{Code: "unauthorized", Message: "authentication required", HTTPStatus: http.StatusUnauthorized}
	ErrInvalidToken  = &Error{Code: "auth.invalid_token", Message: "invalid or expired token", HTTPStatus: http.StatusUnauthorized}
	ErrInvalidCreds  = &Error{Code: "auth.invalid_credentials", Message: "invalid credentials", HTTPStatus: http.StatusUnauthorized}
	ErrForbidden     = &Error{Code: "forbidden", Message: "access denied", HTTPStatus: http.StatusForbidden}
	ErrValidation    = &Error{Code: "validation", Message: "request validation failed", HTTPStatus: http.StatusBadRequest}
	ErrUnprocessable = &Error{Code: "unprocessable", Message: "request cannot be processed", HTTPStatus: http.StatusUnprocessableEntity}
	ErrInternal      = &Error{Code: "internal", Message: "internal server error", HTTPStatus: http.StatusInternalServerError}
)

// Write sends the canonical error envelope. It walks the error chain to find an *Error;
// anything unrecognized becomes a 500.
func Write(c *gin.Context, err error) {
	var ae *Error
	if !errors.As(err, &ae) {
		ae = ErrInternal
	}
	body := gin.H{
		"error": gin.H{
			"code":    ae.Code,
			"message": ae.Message,
			"details": ae.Details,
		},
		"request_id": c.GetString("request_id"),
	}
	c.AbortWithStatusJSON(ae.HTTPStatus, body)
}

// WriteValidation maps go-playground/validator errors into a 400 with per-field details.
func WriteValidation(c *gin.Context, err error) {
	var ve validator.ValidationErrors
	if errors.As(err, &ve) {
		details := make(map[string]any, len(ve))
		for _, fe := range ve {
			details[fe.Field()] = fmt.Sprintf("failed on %q", fe.Tag())
		}
		Write(c, ErrValidation.WithDetails(details))
		return
	}
	Write(c, ErrValidation.WithMessage(err.Error()))
}
