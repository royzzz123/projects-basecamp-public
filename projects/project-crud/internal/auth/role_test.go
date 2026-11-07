package auth

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestRole_Includes(t *testing.T) {
	t.Parallel()

	cases := []struct {
		caller, target Role
		want           bool
	}{
		{RoleDeveloper, RoleDeveloper, true},
		{RoleDeveloper, RoleAdmin, true},
		{RoleDeveloper, RoleBusinessUser, true},
		{RoleAdmin, RoleDeveloper, false},
		{RoleAdmin, RoleAdmin, true},
		{RoleAdmin, RoleBusinessUser, true},
		{RoleBusinessUser, RoleAdmin, false},
		{RoleBusinessUser, RoleBusinessUser, true},
		{Role("garbage"), RoleBusinessUser, false},
	}
	for _, tc := range cases {
		t.Run(string(tc.caller)+"_includes_"+string(tc.target), func(t *testing.T) {
			assert.Equal(t, tc.want, tc.caller.Includes(tc.target))
		})
	}
}

func TestRole_Valid(t *testing.T) {
	t.Parallel()
	assert.True(t, RoleDeveloper.Valid())
	assert.True(t, RoleAdmin.Valid())
	assert.True(t, RoleBusinessUser.Valid())
	assert.False(t, Role("").Valid())
	assert.False(t, Role("platform_admin").Valid()) // renamed away
}

func TestRole_IsCrossOrg(t *testing.T) {
	t.Parallel()
	assert.True(t, RoleDeveloper.IsCrossOrg())
	assert.False(t, RoleAdmin.IsCrossOrg())
	assert.False(t, RoleBusinessUser.IsCrossOrg())
}
