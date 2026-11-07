package config

import (
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/caarlos0/env/v11"
)

type Config struct {
	Env       string        `env:"ENV" envDefault:"dev"`
	HTTPPort  int           `env:"HTTP_PORT" envDefault:"8080"`
	MongoURI  string        `env:"MONGO_URI,required"`
	MongoDB   string        `env:"MONGO_DB,required"`
	JWTSecret string        `env:"JWT_SECRET,required"`
	JWTIssuer string        `env:"JWT_ISSUER" envDefault:"sebi-crud"`
	JWTTTL    time.Duration `env:"JWT_TTL" envDefault:"24h"`
	// SystemAPIKey, when non-empty, enables an `X-System-Key` header bypass
	// for service-to-service calls. Disabled when empty.
	SystemAPIKey    string        `env:"SYSTEM_API_KEY"`
	LogLevel        string        `env:"LOG_LEVEL" envDefault:"info"`
	ShutdownTimeout time.Duration `env:"SHUTDOWN_TIMEOUT" envDefault:"15s"`
	CORSOrigins     []string      `env:"CORS_ORIGINS" envSeparator:","`

	ComplaintsPageDefault int `env:"COMPLAINTS_PAGE_DEFAULT" envDefault:"50"`
	ComplaintsPageMax     int `env:"COMPLAINTS_PAGE_MAX"     envDefault:"200"`
	EntitiesPageDefault   int `env:"ENTITIES_PAGE_DEFAULT"   envDefault:"20"`
	EntitiesPageMax       int `env:"ENTITIES_PAGE_MAX"       envDefault:"100"`
	EntityListPageDefault int `env:"ENTITY_LIST_PAGE_DEFAULT" envDefault:"20"`
	EntityListPageMax     int `env:"ENTITY_LIST_PAGE_MAX"     envDefault:"50"`
	// DashboardSubcat* caps GET /v1/dashboard/volume-by-subcategory's top-N.
	DashboardSubcatLimitDefault int `env:"DASHBOARD_SUBCAT_LIMIT_DEFAULT" envDefault:"50"`
	DashboardSubcatLimitMax     int `env:"DASHBOARD_SUBCAT_LIMIT_MAX"     envDefault:"200"`
}

var validEnvs = map[string]struct{}{
	"dev":     {},
	"staging": {},
	"prod":    {},
}

func Load() (Config, error) {
	var cfg Config
	if err := env.Parse(&cfg); err != nil {
		return Config{}, fmt.Errorf("parsing config: %w", err)
	}
	if err := cfg.validate(); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

func MustLoad() Config {
	cfg, err := Load()
	if err != nil {
		fmt.Fprintf(os.Stderr, "config load failed: %v\n", err)
		os.Exit(1)
	}
	return cfg
}

func (c Config) IsProd() bool { return c.Env == "prod" }
func (c Config) IsDev() bool  { return c.Env == "dev" }

func (c Config) validate() error {
	if _, ok := validEnvs[c.Env]; !ok {
		return fmt.Errorf("invalid ENV %q (must be dev|staging|prod)", c.Env)
	}
	if len(c.JWTSecret) < 32 {
		return errors.New("JWT_SECRET must be at least 32 bytes")
	}
	if c.SystemAPIKey != "" && len(c.SystemAPIKey) < 32 {
		return errors.New("SYSTEM_API_KEY must be at least 32 bytes when set")
	}
	if c.HTTPPort < 1 || c.HTTPPort > 65535 {
		return fmt.Errorf("invalid HTTP_PORT %d", c.HTTPPort)
	}
	if c.JWTTTL <= 0 {
		return errors.New("JWT_TTL must be positive")
	}
	if c.ShutdownTimeout <= 0 {
		return errors.New("SHUTDOWN_TIMEOUT must be positive")
	}
	if c.IsProd() {
		for _, o := range c.CORSOrigins {
			if o == "*" {
				return errors.New("CORS_ORIGINS cannot contain '*' in prod")
			}
		}
	}
	if err := validatePageBounds("COMPLAINTS", c.ComplaintsPageDefault, c.ComplaintsPageMax); err != nil {
		return err
	}
	if err := validatePageBounds("ENTITIES", c.EntitiesPageDefault, c.EntitiesPageMax); err != nil {
		return err
	}
	if err := validatePageBounds("ENTITY_LIST", c.EntityListPageDefault, c.EntityListPageMax); err != nil {
		return err
	}
	return validatePageBounds("DASHBOARD_SUBCAT_LIMIT", c.DashboardSubcatLimitDefault, c.DashboardSubcatLimitMax)
}

func validatePageBounds(resource string, def, maxN int) error {
	const hardCap = 500
	if def < 1 {
		return fmt.Errorf("%s_PAGE_DEFAULT must be >= 1 (got %d)", resource, def)
	}
	if maxN < def {
		return fmt.Errorf("%s_PAGE_MAX (%d) must be >= %s_PAGE_DEFAULT (%d)", resource, maxN, resource, def)
	}
	if maxN > hardCap {
		return fmt.Errorf("%s_PAGE_MAX (%d) exceeds hard cap of %d", resource, maxN, hardCap)
	}
	return nil
}
