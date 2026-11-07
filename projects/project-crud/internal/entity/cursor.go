package entity

import (
	"encoding/base64"
	"encoding/json"

	"github.com/OnFinance/project-crud/internal/apperror"
)

// ---- Typeahead cursor (last userid, string) ------------------------------

type filterCursor struct {
	U string `json:"u"`
}

func encodeFilterCursor(userid string) string {
	b, _ := json.Marshal(filterCursor{U: userid})
	return base64.RawURLEncoding.EncodeToString(b)
}

func decodeFilterCursor(s string) (*string, error) {
	if s == "" {
		return nil, nil
	}
	raw, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return nil, apperror.ErrValidation.WithMessage("invalid cursor")
	}
	var c filterCursor
	if err := json.Unmarshal(raw, &c); err != nil {
		return nil, apperror.ErrValidation.WithMessage("invalid cursor")
	}
	return &c.U, nil
}

// ---- List cursor (last complaint_count + uid) ----------------------------

// ListCursor is the decoded form of the list endpoint's cursor. The list is
// sorted by (complaint_count DESC, uid DESC), so paging needs both axes:
// uid alone is no longer unique in sort position.
type ListCursor struct {
	ComplaintCount int64
	UID            int64
}

type listCursor struct {
	C int64 `json:"c"`
	U int64 `json:"u"`
}

func encodeListCursor(cc, uid int64) string {
	b, _ := json.Marshal(listCursor{C: cc, U: uid})
	return base64.RawURLEncoding.EncodeToString(b)
}

func decodeListCursor(s string) (*ListCursor, error) {
	if s == "" {
		return nil, nil
	}
	raw, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return nil, apperror.ErrValidation.WithMessage("invalid cursor")
	}
	var c listCursor
	if err := json.Unmarshal(raw, &c); err != nil {
		return nil, apperror.ErrValidation.WithMessage("invalid cursor")
	}
	return &ListCursor{ComplaintCount: c.C, UID: c.U}, nil
}
