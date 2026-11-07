# CLAUDE.md — Industry-standard Go CRUD service

This file tells Claude Code how to build and extend this service. Follow it strictly. When a rule here conflicts with a quick-and-dirty solution, the rule wins.

---

## 1. Stack (do not change without discussion)

- **Language**: Go 1.23+ (use the latest stable in `go.mod`)
- **HTTP framework**: Gin (`github.com/gin-gonic/gin`)
- **Database**: MongoDB (`go.mongodb.org/mongo-driver/v2`)
- **Auth**: JWT HS256 (`github.com/golang-jwt/jwt/v5`)
- **Validation**: `github.com/go-playground/validator/v10` (Gin's default binding)
- **Logging**: `log/slog` (stdlib, JSON handler in prod)
- **Config**: `github.com/caarlos0/env/v11` + `.env` loaded only in dev
- **Migrations**: `github.com/golang-migrate/migrate/v4` with the Mongo driver, OR a hand-written `internal/migrate` package that records applied versions in a `_migrations` collection. Pick one and stick to it.
- **Metrics**: Prometheus client (`github.com/prometheus/client_golang`)
- **Tests**: stdlib `testing` + `github.com/stretchr/testify` for assertions. Integration tests use `testcontainers-go` to spin up MongoDB.

---

## 2. Project layout

Follow the **standard Go project layout**. Everything below is mandatory.

```
.
├── cmd/
│   └── server/
│       └── main.go              # Tiny — only wires deps and starts the server
├── internal/                    # All app code lives here (not importable externally)
│   ├── config/                  # Config struct + loader + validation
│   ├── server/                  # HTTP server, router, middleware wiring, graceful shutdown
│   ├── middleware/              # auth, request_id, logger, recover, cors, ratelimit
│   ├── auth/                    # JWT issue/verify, role constants, RBAC middleware
│   ├── db/
│   │   └── mongo/               # Mongo client, indexes, transaction helper
│   ├── domain/                  # Pure domain types (no Mongo/Gin imports)
│   ├── <resource>/              # One folder per resource (see §4)
│   │   ├── model.go             # Mongo BSON struct + DTOs
│   │   ├── repository.go        # Interface + Mongo impl
│   │   ├── service.go           # Business logic
│   │   ├── handler.go           # Gin handlers (thin)
│   │   ├── routes.go            # Route registration
│   │   └── *_test.go
│   ├── apperror/                # Sentinel errors + HTTP mapping
│   └── observability/           # slog setup, prometheus, /health, /readyz
├── migrations/                  # Numbered migration files
├── api/
│   └── openapi.yaml             # Source-of-truth API spec
├── deploy/
│   ├── Dockerfile
│   └── docker-compose.yml       # For local dev only
├── scripts/                     # One-off scripts. Document each one.
├── .env.example                 # Every env var documented. Never commit a real .env
├── .golangci.yml
├── Makefile
├── go.mod
├── go.sum
├── README.md
└── CLAUDE.md                    # This file
```

**Rules:**
- `cmd/server/main.go` MUST be under 100 lines. It only loads config, builds dependencies, and calls `server.Run(ctx)`.
- Nothing in `internal/` may import from `cmd/`.
- `internal/domain/` may NOT import Gin, Mongo, or any HTTP/DB library. It contains pure types and business rules.
- Repositories return domain types, not raw `bson.M`. Mapping happens inside the repository.
- Handlers MUST NOT call MongoDB directly. Always go through a service.
- Services MUST NOT import Gin or `*http.Request`. Pass primitives + `context.Context`.

---

## 3. Configuration

All config comes from environment variables. No hardcoded URLs, secrets, or hostnames anywhere.

```go
// internal/config/config.go
type Config struct {
    Env             string        `env:"ENV" envDefault:"dev"`               // dev | staging | prod
    HTTPPort        int           `env:"HTTP_PORT" envDefault:"8080"`
    MongoURI        string        `env:"MONGO_URI,required"`
    MongoDB         string        `env:"MONGO_DB,required"`
    JWTSecret       string        `env:"JWT_SECRET,required"`               // min 32 bytes
    JWTIssuer       string        `env:"JWT_ISSUER" envDefault:"sebi-crud"`
    JWTTTL          time.Duration `env:"JWT_TTL" envDefault:"24h"`
    LogLevel        string        `env:"LOG_LEVEL" envDefault:"info"`
    ShutdownTimeout time.Duration `env:"SHUTDOWN_TIMEOUT" envDefault:"15s"`
    CORSOrigins     []string      `env:"CORS_ORIGINS" envSeparator:","`
}
```

**Rules:**
- `Load()` MUST fail fast on missing required vars. Do not fall back to dev defaults for secrets.
- Validate `JWTSecret` length (>= 32) and `Env` enum at load time.
- Every var goes into `.env.example` with a comment.
- `JWT_SECRET` and `MONGO_URI` are NEVER logged, even at debug level.

---

## 4. Adding a new resource (THE workflow)

When asked to add a resource (e.g., `Invoice`), create exactly these files under `internal/invoice/`:

1. **`model.go`** — Mongo BSON struct, request DTOs (`CreateInvoiceRequest`, `UpdateInvoiceRequest`), response DTOs. Use `validate:"..."` tags on requests. Never expose internal fields (`_id` ObjectID, audit fields) without an explicit DTO.
2. **`repository.go`** — Define `Repository` interface first, then `mongoRepository` impl. Methods: `Create`, `GetByID`, `List`, `Update`, `Delete`. Always take `ctx context.Context` as first arg. Return `apperror.ErrNotFound` for missing docs.
3. **`service.go`** — `Service` struct holding the `Repository` interface (NOT the concrete type). Business rules + authorization checks live here.
4. **`handler.go`** — Thin Gin handlers. Bind + validate request, call service, map result/error to HTTP. No business logic.
5. **`routes.go`** — `func RegisterRoutes(rg *gin.RouterGroup, h *Handler, authz *auth.Middleware)`. Apply RBAC middleware here.
6. **`service_test.go`** — Table-driven unit tests using a mock repository.
7. **`handler_test.go`** — `httptest` integration tests against a real router with a mock service.
8. **Add indexes** in `internal/db/mongo/indexes.go` (one place for ALL collection indexes, applied at startup).
9. **Update** `api/openapi.yaml` with the new endpoints.

DO NOT add a resource without all of these. DO NOT skip tests "for now."

---

## 5. MongoDB conventions

```go
type Invoice struct {
    ID        bson.ObjectID `bson:"_id,omitempty"        json:"id"`
    OrgID     bson.ObjectID `bson:"org_id"               json:"org_id"`
    Number    string        `bson:"number"               json:"number"`
    Amount    int64         `bson:"amount_minor_units"   json:"amount_minor_units"` // money in minor units, never float
    Status    string        `bson:"status"               json:"status"`
    CreatedBy bson.ObjectID `bson:"created_by"           json:"created_by"`
    CreatedAt time.Time     `bson:"created_at"           json:"created_at"`
    UpdatedAt time.Time     `bson:"updated_at"           json:"updated_at"`
    DeletedAt *time.Time    `bson:"deleted_at,omitempty" json:"deleted_at,omitempty"`
}
```

**Rules:**
- Field names: `snake_case` in BSON, `snake_case` in JSON, `PascalCase` in Go.
- Money: store as `int64` minor units. Never `float64`.
- Timestamps: `time.Time` UTC. Always set `created_at` / `updated_at`.
- Soft-delete with `deleted_at` if delete is reversible; otherwise hard delete.
- ObjectIDs: `bson.ObjectID` (v2 driver). Do not store as string.
- **Indexes are declared once** in `internal/db/mongo/indexes.go` and ensured at startup with `CreateIndexes`. Never `DropIndex` at runtime.
- **Multi-document writes that must be atomic MUST use a transaction**:
  ```go
  err := mongoClient.UseSession(ctx, func(sc mongo.SessionContext) error {
      if err := sc.StartTransaction(); err != nil { return err }
      // ... writes ...
      return sc.CommitTransaction(sc)
  })
  ```
- Always pass `ctx` to driver calls. Repositories MUST honor cancellation.
- Use `bson.M` / `bson.D` parameter maps. Never build queries by string concat.
- Pagination: cursor-based (`?after=<id>&limit=N`) preferred. Offset is allowed only for admin tooling.
- List endpoints MUST cap `limit` (default 50, max 200).

---

## 6. HTTP layer (Gin)

### Router setup
```go
r := gin.New()
r.Use(
    middleware.RequestID(),
    middleware.Recover(logger),         // structured panic logger; do NOT use gin.Recovery()
    middleware.SLog(logger),            // request logger
    middleware.CORS(cfg.CORSOrigins),
    middleware.BodyLimit(1 << 20),      // 1 MiB default, override per-route if needed
    middleware.RateLimit(100, time.Minute), // per-IP token bucket
)
```

### Handler shape — copy this pattern
```go
func (h *Handler) Create(c *gin.Context) {
    var req CreateInvoiceRequest
    if err := c.ShouldBindJSON(&req); err != nil {
        apperror.WriteValidation(c, err)
        return
    }
    out, err := h.svc.Create(c.Request.Context(), auth.MustClaims(c), req)
    if err != nil {
        apperror.Write(c, err)
        return
    }
    c.JSON(http.StatusCreated, out)
}
```

**Status codes — use these, no others:**
- `200 OK` — successful read/update returning a body
- `201 Created` — successful create
- `204 No Content` — successful delete or update with no body
- `400 Bad Request` — malformed JSON, validation failure
- `401 Unauthorized` — missing or invalid token
- `403 Forbidden` — authenticated but not allowed
- `404 Not Found` — resource doesn't exist OR caller can't see it (don't leak existence)
- `409 Conflict` — uniqueness violation, version conflict
- `422 Unprocessable Entity` — semantic validation failure (e.g., business rule)
- `429 Too Many Requests` — rate limited
- `500 Internal Server Error` — unexpected; log with stack trace

**NEVER** return `203 Non-Authoritative Information` for a successful read. (This was a bug in the old service.)

### Error response shape (consistent across the whole API)
```json
{
  "error": {
    "code": "invoice.not_found",
    "message": "Invoice not found",
    "details": {}
  },
  "request_id": "01HQXYZ..."
}
```

### Updates
Update endpoints accept a **typed DTO**, never `bson.M` or `map[string]any` from the client. Whitelist updatable fields explicitly.

---

## 7. Authentication (JWT HS256)

`internal/auth/jwt.go` exposes:
```go
func Issue(cfg Config, claims Claims) (string, error)
func Verify(cfg Config, token string) (Claims, error)
```

Claims:
```go
type Claims struct {
    UserID bson.ObjectID `json:"sub"`
    OrgID  bson.ObjectID `json:"org_id"`
    Role   Role          `json:"role"`     // developer | admin | business_user
    jwt.RegisteredClaims                   // iss, exp, iat, jti
}
```

`Authenticate()` middleware:
1. Reads `Authorization: Bearer <token>`.
2. Verifies signature, exp, issuer.
3. On success: stores `Claims` in `c.Set("claims", c)`.
4. On failure: returns `401` with `auth.invalid_token` error code. Never `403`.

Helper: `auth.MustClaims(c)` panics if missing — only call from inside an authenticated route group. The recover middleware will catch the panic and return 500 (this should never happen in practice).

**Never** read user identity from query strings, headers other than `Authorization`, or request bodies. (This was the critical bug in the old service.)

---

## 8. Authorization (RBAC)

Three roles, hierarchical from most → least privileged:

| Role             | Description                                              |
|------------------|----------------------------------------------------------|
| `developer`      | Cross-org access, internal-team-only, extra screens/rights |
| `admin`          | Full access within their org                             |
| `business_user`  | Read + limited writes within their org                   |

Define once in `internal/auth/role.go`:
```go
type Role string

const (
    RoleDeveloper    Role = "developer"
    RoleAdmin        Role = "admin"
    RoleBusinessUser Role = "business_user"
)

func (r Role) Includes(other Role) bool { /* hierarchy check */ }
```

### Route-level RBAC
```go
g := r.Group("/invoices", authz.Authenticate())
g.POST("",       authz.Require(auth.RoleBusinessUser), h.Create)
g.GET("",        authz.Require(auth.RoleBusinessUser), h.List)
g.GET("/:id",    authz.Require(auth.RoleBusinessUser), h.Get)
g.PATCH("/:id",  authz.Require(auth.RoleAdmin),        h.Update)
g.DELETE("/:id", authz.Require(auth.RoleAdmin),        h.Delete)
```

### Row-level scoping (mandatory)
Every list/get/update query MUST be scoped by `org_id` from claims, EXCEPT when caller is a `developer` (cross-org):
```go
filter := bson.M{"_id": id}
if !claims.Role.IsCrossOrg() {
    filter["org_id"] = claims.OrgID
}
```

This is the single most important security rule. **Every repository method that takes an ID MUST also take `org_id`** (or accept `Claims` and apply the rule itself). Do not rely on the handler to filter — push it down.

---

## 9. Error handling

```go
// internal/apperror/apperror.go
var (
    ErrNotFound      = &Error{Code: "not_found",      HTTPStatus: 404}
    ErrConflict      = &Error{Code: "conflict",       HTTPStatus: 409}
    ErrUnauthorized  = &Error{Code: "unauthorized",   HTTPStatus: 401}
    ErrForbidden     = &Error{Code: "forbidden",      HTTPStatus: 403}
    ErrValidation    = &Error{Code: "validation",     HTTPStatus: 400}
    ErrUnprocessable = &Error{Code: "unprocessable",  HTTPStatus: 422}
)
```

**Rules:**
- Wrap with `fmt.Errorf("creating invoice: %w", err)`. ALWAYS use `%w`, never `%v`.
- Use `errors.Is(err, apperror.ErrNotFound)` at boundaries.
- Repository converts driver errors: `mongo.ErrNoDocuments → apperror.ErrNotFound`, duplicate key → `apperror.ErrConflict`.
- `apperror.Write(c, err)` is the ONLY way to return errors from handlers.
- Never `panic`. Never `log.Fatal` outside `cmd/server/main.go`.
- Never swallow errors with `_ = ...` unless there's a `// reason: ...` comment.

---

## 10. Logging (slog)

```go
logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: lvl}))
slog.SetDefault(logger)
```

**Rules:**
- JSON in prod, text in dev (gated by `cfg.Env`).
- Every request gets a `request_id` (UUIDv7 or ULID) injected by middleware and added to every log line via `slog.With`.
- Pass the request-scoped logger via `ctx` (`slog.LoggerFromContext`-style helper).
- **Never log**: `JWT_SECRET`, `MONGO_URI`, raw JWT tokens, full request bodies, PII. Log IDs, not values.
- Levels: `debug` (dev only), `info` (request lifecycle, state changes), `warn` (recoverable anomalies), `error` (handled failures with context).
- No `fmt.Println` in committed code. Ever.

---

## 11. Observability

- `GET /health` — liveness, returns 200 if process is up.
- `GET /readyz` — readiness, pings Mongo. 503 if not ready.
- `GET /metrics` — Prometheus, includes:
  - `http_request_duration_seconds{method,route,status}` (histogram)
  - `http_requests_in_flight` (gauge)
  - `mongo_command_duration_seconds{command,collection}` (histogram)
- `GET /version` — returns build info from `-ldflags` (NOT hardcoded strings).

Build info via ldflags:
```
-X main.version=$(git describe --tags --always) -X main.commit=$(git rev-parse HEAD) -X main.buildTime=$(date -u +%Y-%m-%dT%H:%M:%SZ)
```

---

## 12. Testing

**Coverage targets:** services 80%+, handlers 70%+, repositories covered by integration tests.

### Unit tests (services)
Table-driven, mock the repository:
```go
func TestService_Create(t *testing.T) {
    tests := []struct {
        name    string
        in      CreateInvoiceRequest
        setup   func(*mockRepo)
        wantErr error
    }{
        {"success", validReq, func(m *mockRepo) { m.On("Create", ...).Return(nil) }, nil},
        {"duplicate", validReq, func(m *mockRepo) { m.On("Create", ...).Return(apperror.ErrConflict) }, apperror.ErrConflict},
    }
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) { /* ... */ })
    }
}
```

### Integration tests (repositories)
Use `testcontainers-go` to spin a real Mongo. Each test gets a fresh DB. Run with `go test -tags=integration`.

### Handler tests
`httptest.NewRecorder()` against the actual router. Mock the service. Assert status code, body shape, headers.

**Rules:**
- No test depends on another test's state.
- No `time.Sleep` in tests — use clocks or channels.
- `t.Parallel()` everywhere it's safe.
- Test files live next to the code (`foo.go` + `foo_test.go`).

---

## 13. Security checklist (every PR)

- [ ] No secrets in source, in logs, or in error messages.
- [ ] All routes (except `/health`, `/readyz`, `/metrics`, `/version`, login) sit behind `Authenticate()`.
- [ ] All write routes have an explicit `Require(role)`.
- [ ] All queries are scoped by `org_id` for non-platform-admin callers.
- [ ] Update DTOs whitelist fields. No raw `bson.M` from clients.
- [ ] Body size limit middleware applied.
- [ ] Rate limit middleware applied.
- [ ] CORS origins are an explicit allowlist (no `*` in prod).
- [ ] Inputs validated with `validator` tags.
- [ ] No new dependency added without checking `govulncheck` and license.

---

## 14. Docker

`deploy/Dockerfile` — multi-stage, distroless, non-root:
```dockerfile
FROM golang:1.23-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
ARG VERSION=dev
ARG COMMIT=unknown
ARG BUILD_TIME=unknown
RUN CGO_ENABLED=0 GOOS=linux go build \
    -ldflags="-s -w -X main.version=${VERSION} -X main.commit=${COMMIT} -X main.buildTime=${BUILD_TIME}" \
    -o /out/server ./cmd/server

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/server /server
USER nonroot:nonroot
EXPOSE 8080
ENTRYPOINT ["/server"]
```

No `COPY . /app` of source files into the runtime image. No shell. No package manager.

---

## 15. Graceful shutdown (mandatory)

`cmd/server/main.go`:
```go
func main() {
    cfg := config.MustLoad()
    logger := observability.NewLogger(cfg)
    app, err := server.New(cfg, logger)
    if err != nil { logger.Error("init failed", "err", err); os.Exit(1) }

    ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
    defer stop()

    if err := app.Run(ctx); err != nil {
        logger.Error("server exited with error", "err", err)
        os.Exit(1)
    }
}
```

`server.Run` starts `http.Server`, waits for `ctx.Done()`, then calls `Shutdown(shutdownCtx)` with `cfg.ShutdownTimeout`. It MUST close the Mongo client after the HTTP server stops accepting new requests but before exit.

---

## 16. Dev workflow

### Required tools
- `golangci-lint` (config in `.golangci.yml`, enable: `errcheck`, `govet`, `staticcheck`, `gosec`, `revive`, `gocritic`, `bodyclose`, `contextcheck`, `nilerr`, `errorlint`)
- `govulncheck`
- `gofumpt` (stricter `gofmt`)

### Makefile targets (mandatory)
```
make run          # go run ./cmd/server with dev .env
make test         # unit tests
make test-int     # integration tests with testcontainers
make lint         # golangci-lint run ./...
make vuln         # govulncheck ./...
make build        # produce binary with ldflags
make docker       # build container
make migrate-up   # apply migrations
make migrate-new NAME=add_invoices  # new migration file
```

### Before any commit
`make lint test vuln` MUST pass. CI runs the same.

---

## 17. Anti-patterns (do NOT do these — they were bugs in the previous service)

1. ❌ Reading `user_id` from query string for auth. ✅ Always JWT.
2. ❌ Hardcoded credentials / URLs / API keys in code. ✅ Env vars, fail-fast on missing.
3. ❌ A 500-line `main.go` doing everything. ✅ `cmd/server/main.go` < 100 lines.
4. ❌ Returning `203 Non-Authoritative Information` from reads. ✅ `200 OK`.
5. ❌ Conflating 401 (unauthenticated) with 403 (forbidden). ✅ Distinct codes.
6. ❌ Update endpoints that accept arbitrary `bson.M`. ✅ Typed DTOs only.
7. ❌ `fmt.Println` in production code paths. ✅ `slog`.
8. ❌ `log.Fatal` outside `main`. ✅ Return errors.
9. ❌ Multi-step writes without transactions. ✅ Mongo sessions for atomicity.
10. ❌ Loading config files via `runtime.Caller(0)` paths. ✅ Embed (`//go:embed`) or env vars.
11. ❌ Constructing dependencies inside services (`NewRBACService(db)` from inside another service). ✅ Inject everything via constructor.
12. ❌ `%v` for error wrapping. ✅ `%w` always.
13. ❌ Zero tests. ✅ Required for every PR.
14. ❌ `gin.Default()` in prod (no body limit, weak recovery). ✅ Explicit middleware stack.
15. ❌ Backup files (`*.go.backup`), stray scripts, `*.txt` design notes in package directories. ✅ Keep packages clean; design docs go in `docs/`.

---

## 18. Instructions for Claude Code specifically

When the user asks you to:

- **"Add a resource X"** → Follow §4 to the letter. Create all 9 artifacts. Do not skip tests. Do not skip the OpenAPI update.
- **"Add an endpoint"** → Add handler + route + service method + test. Update OpenAPI. Add RBAC requirement.
- **"Fix a bug"** → Add a failing test first, then fix. Do not refactor unrelated code in the same change.
- **"Refactor"** → Confirm scope before starting. Do not expand beyond what was asked.
- **"Add a dependency"** → Justify it. Prefer stdlib. Run `govulncheck` after.
- **Anything that looks like an anti-pattern in §17** → Push back. Suggest the right approach.

When in doubt about a design decision, ASK. Do not silently pick. Do not invent fields, tables, or routes that weren't requested.

Keep every change small, tested, and aligned with the conventions above. If you find yourself fighting the conventions, raise it for discussion before working around them.
