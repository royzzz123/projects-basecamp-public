package auth

import (
	"strings"
	"testing"
	"time"

	"github.com/OnFinance/project-crud/internal/config"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.mongodb.org/mongo-driver/v2/bson"
)

func newTestIssuer(t *testing.T) *Issuer {
	t.Helper()
	return NewIssuer(config.Config{
		JWTSecret: strings.Repeat("a", 32),
		JWTIssuer: "test",
		JWTTTL:    time.Hour,
	})
}

func TestIssueAndVerify_RoundTrip(t *testing.T) {
	t.Parallel()
	iss := newTestIssuer(t)

	uid := bson.NewObjectID()
	oid := bson.NewObjectID()
	orig := Claims{UserID: uid, OrgID: &oid, Role: RoleAdmin}

	token, exp, err := iss.Issue(orig)
	require.NoError(t, err)
	require.NotEmpty(t, token)
	assert.WithinDuration(t, time.Now().Add(time.Hour), exp, 5*time.Second)

	got, err := iss.Verify(token)
	require.NoError(t, err)
	assert.Equal(t, uid, got.UserID)
	require.NotNil(t, got.OrgID)
	assert.Equal(t, oid, *got.OrgID)
	assert.Equal(t, RoleAdmin, got.Role)
	assert.Equal(t, "test", got.Issuer)
}

func TestVerify_Expired(t *testing.T) {
	t.Parallel()
	iss := newTestIssuer(t).withClock(func() time.Time {
		return time.Now().Add(-2 * time.Hour)
	})
	token, _, err := iss.Issue(Claims{UserID: bson.NewObjectID(), Role: RoleAdmin})
	require.NoError(t, err)

	_, err = newTestIssuer(t).Verify(token)
	require.Error(t, err)
}

func TestVerify_Tampered(t *testing.T) {
	t.Parallel()
	iss := newTestIssuer(t)
	token, _, err := iss.Issue(Claims{UserID: bson.NewObjectID(), Role: RoleAdmin})
	require.NoError(t, err)

	// flip the last byte of the signature
	tampered := token[:len(token)-1] + "x"
	_, err = iss.Verify(tampered)
	require.Error(t, err)
}

func TestVerify_WrongIssuer(t *testing.T) {
	t.Parallel()
	other := NewIssuer(config.Config{
		JWTSecret: strings.Repeat("a", 32),
		JWTIssuer: "someone-else",
		JWTTTL:    time.Hour,
	})
	token, _, err := other.Issue(Claims{UserID: bson.NewObjectID(), Role: RoleAdmin})
	require.NoError(t, err)

	_, err = newTestIssuer(t).Verify(token)
	require.Error(t, err)
}

func TestVerify_UnknownRoleRejected(t *testing.T) {
	t.Parallel()
	iss := newTestIssuer(t)
	token, _, err := iss.Issue(Claims{UserID: bson.NewObjectID(), Role: Role("janitor")})
	require.NoError(t, err)

	_, err = iss.Verify(token)
	require.Error(t, err)
}
