// Package domain holds pure types and business rules. No bson, no gin,
// no HTTP, no DB driver imports here — that is enforced by CLAUDE.md §2.
package domain

import "time"

type User struct {
	ID        string
	Email     string
	Role      string
	OrgID     *string
	CreatedAt time.Time
	UpdatedAt time.Time
	DeletedAt *time.Time
}

type Org struct {
	ID        string
	Slug      string
	Name      string
	CreatedAt time.Time
	UpdatedAt time.Time
}
