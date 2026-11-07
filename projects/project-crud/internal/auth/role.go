package auth

// Role hierarchy: developer ⊇ admin ⊇ business_user.
// developer is cross-org (no org_id scoping); admin and business_user are
// always scoped to their own org_id.
type Role string

const (
	RoleDeveloper    Role = "developer"
	RoleAdmin        Role = "admin"
	RoleBusinessUser Role = "business_user"
)

var roleRank = map[Role]int{
	RoleBusinessUser: 1,
	RoleAdmin:        2,
	RoleDeveloper:    3,
}

func (r Role) Valid() bool {
	_, ok := roleRank[r]
	return ok
}

// Includes reports whether r has at least the privileges of other.
// e.g. RoleAdmin.Includes(RoleBusinessUser) == true.
func (r Role) Includes(other Role) bool {
	return roleRank[r] >= roleRank[other] && roleRank[r] > 0
}

// IsCrossOrg returns true for roles that are not scoped to a single org_id.
func (r Role) IsCrossOrg() bool { return r == RoleDeveloper }
