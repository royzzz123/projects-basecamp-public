package complaint

import (
	"encoding/base64"
	"encoding/json"

	"github.com/OnFinance/project-crud/internal/apperror"
)

// Cursor encodes "the last complaintid returned on the previous page".
// Values are non-secret monotonic IDs — no HMAC needed.
type cursor struct {
	C int64 `json:"c"`
}

func encodeCursor(id int64) string {
	b, _ := json.Marshal(cursor{C: id}) // marshalling a fixed struct can't fail
	return base64.RawURLEncoding.EncodeToString(b)
}

func decodeCursor(s string) (*int64, error) {
	if s == "" {
		return nil, nil
	}
	raw, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return nil, apperror.ErrValidation.WithMessage("invalid cursor")
	}
	var c cursor
	if err := json.Unmarshal(raw, &c); err != nil {
		return nil, apperror.ErrValidation.WithMessage("invalid cursor")
	}
	return &c.C, nil
}
