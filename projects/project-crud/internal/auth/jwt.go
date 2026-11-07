package auth

import (
	"errors"
	"fmt"
	"time"

	"github.com/OnFinance/project-crud/internal/config"
	"github.com/golang-jwt/jwt/v5"
)

type Issuer struct {
	secret []byte
	issuer string
	ttl    time.Duration
	now    func() time.Time
}

func NewIssuer(cfg config.Config) *Issuer {
	return &Issuer{
		secret: []byte(cfg.JWTSecret),
		issuer: cfg.JWTIssuer,
		ttl:    cfg.JWTTTL,
		now:    time.Now,
	}
}

// withClock is exposed for tests that need a deterministic clock.
func (i *Issuer) withClock(now func() time.Time) *Issuer {
	clone := *i
	clone.now = now
	return &clone
}

// Issue mints a JWT for the given subject. RegisteredClaims (iss, iat, exp, nbf, jti)
// are populated here; callers only supply the identity fields.
func (i *Issuer) Issue(c Claims) (token string, expiresAt time.Time, err error) {
	now := i.now()
	expiresAt = now.Add(i.ttl)
	c.RegisteredClaims = jwt.RegisteredClaims{
		Issuer:    i.issuer,
		Subject:   c.UserID.Hex(),
		IssuedAt:  jwt.NewNumericDate(now),
		NotBefore: jwt.NewNumericDate(now),
		ExpiresAt: jwt.NewNumericDate(expiresAt),
		ID:        jwt.NewNumericDate(now).Format(time.RFC3339Nano),
	}
	t := jwt.NewWithClaims(jwt.SigningMethodHS256, c)
	signed, err := t.SignedString(i.secret)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("signing token: %w", err)
	}
	return signed, expiresAt, nil
}

// Verify parses and validates a token, returning the embedded Claims.
// Returns an error wrapping jwt.Err* sentinels for caller pattern-matching.
func (i *Issuer) Verify(tokenString string) (Claims, error) {
	parsed, err := jwt.ParseWithClaims(
		tokenString,
		&Claims{},
		func(t *jwt.Token) (any, error) {
			if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
			}
			return i.secret, nil
		},
		jwt.WithIssuer(i.issuer),
		jwt.WithValidMethods([]string{"HS256"}),
	)
	if err != nil {
		return Claims{}, fmt.Errorf("parsing token: %w", err)
	}
	if !parsed.Valid {
		return Claims{}, errors.New("token invalid")
	}
	claims, ok := parsed.Claims.(*Claims)
	if !ok {
		return Claims{}, errors.New("token claims wrong type")
	}
	if !claims.Role.Valid() {
		return Claims{}, fmt.Errorf("token role %q is not a known role", claims.Role)
	}
	return *claims, nil
}
