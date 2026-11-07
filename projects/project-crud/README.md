# project-crud

Industry-standard Go CRUD service. Stack: Go 1.23 · Gin · MongoDB · JWT (HS256).

The full spec is in [CLAUDE.md](CLAUDE.md). This README is a quickstart.

## Quickstart (local)

```bash
cp .env.example .env
# edit .env: set MONGO_URI, MONGO_DB, JWT_SECRET (>= 32 bytes)

docker compose -f deploy/docker-compose.yml up -d mongo   # or run your own Mongo
# create the first developer user directly in Mongo (see "Bootstrapping the first user" below)
make run                                                  # starts the API on :8080
```

## Bootstrapping the first user

`POST /v1/auth/signup` is admin-gated, so the very first `developer` user has
to be inserted into Mongo by hand. The password MUST be stored as a bcrypt
hash — the login endpoint compares with `bcrypt.CompareHashAndPassword`.

1. Generate a bcrypt hash for your chosen password (cost 12):
   ```bash
   htpasswd -bnBC 12 "" 'your-strong-password' | tr -d ':\n'
   ```
   Or in Go:
   ```bash
   go run -v - <<'EOF'
   package main
   import ( "fmt"; "golang.org/x/crypto/bcrypt" )
   func main() {
       h, _ := bcrypt.GenerateFromPassword([]byte("your-strong-password"), 12)
       fmt.Println(string(h))
   }
   EOF
   ```

2. Insert the document into the `users` collection:
   ```js
   db.users.insertOne({
       email:         "dev@onfinance.ai",
       password_hash: "$2a$12$...",         // the bcrypt hash from step 1
       role:          "developer",          // no org_id for developers
       created_at:    new Date(),
       updated_at:    new Date()
   })
   ```

3. Log in via `POST /v1/auth/login` to get a JWT, then use that token to call
   `POST /v1/auth/signup` for every subsequent user.

## Auth endpoints (v1)

| Method | Path               | Auth                       | Purpose                              |
|--------|--------------------|----------------------------|--------------------------------------|
| POST   | `/v1/auth/login`   | public                     | exchange email/password for a JWT    |
| POST   | `/v1/auth/signup`  | `admin` or `developer`     | create a new user                    |
| GET    | `/v1/auth/me`      | any authenticated role     | return the caller's user record      |

Ops endpoints: `/health`, `/readyz`, `/metrics`, `/version`.

Error envelope (every non-2xx response):

```json
{ "error": { "code": "...", "message": "...", "details": {} }, "request_id": "01H..." }
```

## Roles

`developer` ⊇ `admin` ⊇ `business_user`. Higher roles inherit access of lower ones.
`developer` is cross-org (no `org_id` scoping). See "Bootstrapping the first user" above for how to create the first one.

## Common commands

```bash
make test        # unit tests
make lint        # golangci-lint
make vuln        # govulncheck
make build       # produce bin/server with ldflags
make docker      # build the distroless image
```

## Project layout

See `CLAUDE.md §2`. TL;DR:

```
cmd/server   tiny main, wires deps
internal/    everything else (config, auth, middleware, db, observability, user, server)
api/         OpenAPI spec
deploy/      Dockerfile + docker-compose for local dev
```
