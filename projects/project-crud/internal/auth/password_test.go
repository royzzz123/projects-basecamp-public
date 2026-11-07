package auth

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestHashAndCheck(t *testing.T) {
	t.Parallel()
	const pw = "correct-horse-battery-staple"
	h, err := HashPassword(pw)
	require.NoError(t, err)
	assert.NotEqual(t, pw, h, "hash must not equal plaintext")

	assert.NoError(t, CheckPassword(pw, h))
	assert.Error(t, CheckPassword("wrong-password", h))
}

func TestHash_DifferentEachTime(t *testing.T) {
	t.Parallel()
	const pw = "same-password"
	h1, err := HashPassword(pw)
	require.NoError(t, err)
	h2, err := HashPassword(pw)
	require.NoError(t, err)
	assert.NotEqual(t, h1, h2, "bcrypt salts must produce distinct hashes")
}
