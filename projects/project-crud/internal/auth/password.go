package auth

import (
	"errors"
	"fmt"

	"golang.org/x/crypto/bcrypt"
)

const bcryptCost = 12

// HashPassword returns a bcrypt hash suitable for storage.
func HashPassword(plain string) (string, error) {
	h, err := bcrypt.GenerateFromPassword([]byte(plain), bcryptCost)
	if err != nil {
		return "", fmt.Errorf("hashing password: %w", err)
	}
	return string(h), nil
}

// CheckPassword reports whether plain matches the stored hash.
// Returns nil on match, a non-nil error otherwise. Callers should treat any
// non-nil return as an authentication failure (do not distinguish causes
// in user-facing error messages — see CLAUDE.md user-enumeration note).
func CheckPassword(plain, hash string) error {
	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(plain)); err != nil {
		if errors.Is(err, bcrypt.ErrMismatchedHashAndPassword) {
			return err
		}
		return fmt.Errorf("comparing password: %w", err)
	}
	return nil
}
