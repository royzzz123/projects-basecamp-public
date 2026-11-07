package server

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/OnFinance/project-crud/internal/auth"
	"github.com/OnFinance/project-crud/internal/complaint"
	"github.com/OnFinance/project-crud/internal/complaintsummary"
	"github.com/OnFinance/project-crud/internal/complaintworkflowanalysis"
	"github.com/OnFinance/project-crud/internal/config"
	"github.com/OnFinance/project-crud/internal/dashboard"
	mongodb "github.com/OnFinance/project-crud/internal/db/mongo"
	"github.com/OnFinance/project-crud/internal/entity"
	"github.com/OnFinance/project-crud/internal/heatmap"
	"github.com/OnFinance/project-crud/internal/keyword"
	"github.com/OnFinance/project-crud/internal/middleware"
	"github.com/OnFinance/project-crud/internal/observability"
	"github.com/OnFinance/project-crud/internal/reclassification"
	"github.com/OnFinance/project-crud/internal/user"
	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/v2/mongo"
)

type App struct {
	cfg         config.Config
	logger      *slog.Logger
	mongoClient *mongo.Client
	httpServer  *http.Server
}

// New wires every dependency and returns an App ready to Run.
// Order matters: connect to Mongo, ensure indexes, then build the router.
func New(ctx context.Context, cfg config.Config, logger *slog.Logger) (*App, error) {
	client, err := mongodb.NewClient(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("mongo: %w", err)
	}
	if err := mongodb.EnsureIndexes(ctx, client.Database(cfg.MongoDB)); err != nil {
		// Parent ctx may already be cancelled; use a fresh bounded ctx for cleanup.
		disconnectCtx, disconnectCancel := context.WithTimeout(context.Background(), 5*time.Second)
		_ = client.Disconnect(disconnectCtx) //nolint:contextcheck // parent ctx may be cancelled; cleanup uses fresh ctx
		disconnectCancel()
		return nil, fmt.Errorf("ensuring indexes: %w", err)
	}

	router := buildRouter(cfg, logger, client) //nolint:contextcheck // gin handlers derive their own per-request context

	srv := &http.Server{
		Addr:              ":" + strconv.Itoa(cfg.HTTPPort),
		Handler:           router,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	return &App{
		cfg:         cfg,
		logger:      logger,
		mongoClient: client,
		httpServer:  srv,
	}, nil
}

func buildRouter(cfg config.Config, logger *slog.Logger, client *mongo.Client) *gin.Engine {
	if cfg.IsProd() {
		gin.SetMode(gin.ReleaseMode)
	}
	r := gin.New()

	// Global middleware stack — order is mandated by CLAUDE.md §6.
	r.Use(
		middleware.RequestID(),
		middleware.Recover(logger),
		middleware.SLog(logger),
		middleware.CORS(cfg.CORSOrigins),
		middleware.BodyLimit(1<<20), // 1 MiB
		middleware.RateLimit(100, time.Minute),
		observability.Metrics(),
	)

	// Ops endpoints (not behind any auth)
	observability.RegisterHealthRoutes(r, client)
	observability.RegisterMetricsRoute(r)

	// Auth wiring
	issuer := auth.NewIssuer(cfg)
	authMW := auth.NewMiddleware(issuer, cfg.SystemAPIKey)

	// v1 resources. SystemKey runs first so service-to-service callers with
	// a valid X-System-Key header bypass downstream JWT + role checks. When
	// cfg.SystemAPIKey is empty, SystemKey is a no-op.
	v1 := r.Group("/v1", authMW.SystemKey())

	db := client.Database(cfg.MongoDB)

	userRepo := user.NewMongoRepository(db)
	userSvc := user.NewService(userRepo, issuer)
	userHandler := user.NewHandler(userSvc)
	user.RegisterRoutes(v1, userHandler, authMW)

	complaintRepo := complaint.NewMongoRepository(db)
	complaintSvc := complaint.NewService(complaintRepo, cfg.ComplaintsPageDefault, cfg.ComplaintsPageMax)
	complaintHandler := complaint.NewHandler(complaintSvc)
	complaint.RegisterRoutes(v1, complaintHandler, authMW)

	entityRepo := entity.NewMongoRepository(db)
	entitySvc := entity.NewService(
		entityRepo,
		cfg.EntitiesPageDefault, cfg.EntitiesPageMax, // typeahead /v1/entities/filter
		cfg.EntityListPageDefault, cfg.EntityListPageMax, // list /v1/entities
	)
	entityHandler := entity.NewHandler(entitySvc)
	entity.RegisterRoutes(v1, entityHandler, authMW)

	heatmapRepo := heatmap.NewMongoRepository(db)
	heatmapSvc := heatmap.NewService(heatmapRepo)
	heatmapHandler := heatmap.NewHandler(heatmapSvc)
	heatmap.RegisterRoutes(v1, heatmapHandler, authMW)

	dashboardRepo := dashboard.NewMongoRepository(db)
	dashboardSvc := dashboard.NewService(dashboardRepo, cfg.DashboardSubcatLimitDefault, cfg.DashboardSubcatLimitMax)
	dashboardHandler := dashboard.NewHandler(dashboardSvc)
	dashboard.RegisterRoutes(v1, dashboardHandler, authMW)

	cwaRepo := complaintworkflowanalysis.NewMongoRepository(db)
	cwaSvc := complaintworkflowanalysis.NewService(cwaRepo)
	cwaHandler := complaintworkflowanalysis.NewHandler(cwaSvc)
	complaintworkflowanalysis.RegisterRoutes(v1, cwaHandler, authMW)

	csRepo := complaintsummary.NewMongoRepository(db)
	csSvc := complaintsummary.NewService(csRepo)
	csHandler := complaintsummary.NewHandler(csSvc)
	complaintsummary.RegisterRoutes(v1, csHandler, authMW)

	reclassRepo := reclassification.NewMongoRepository(db)
	reclassSvc := reclassification.NewService(reclassRepo)
	reclassHandler := reclassification.NewHandler(reclassSvc)
	reclassification.RegisterRoutes(v1, reclassHandler, authMW)

	keywordRepo := keyword.NewMongoRepository(db)
	keywordSvc := keyword.NewService(keywordRepo)
	keywordHandler := keyword.NewHandler(keywordSvc)
	keyword.RegisterRoutes(v1, keywordHandler, authMW)

	return r
}

// Run starts the HTTP server and blocks until ctx is cancelled, then performs
// a graceful shutdown bounded by cfg.ShutdownTimeout.
func (a *App) Run(ctx context.Context) error {
	errCh := make(chan error, 1)
	go func() {
		a.logger.Info("http server listening", "addr", a.httpServer.Addr)
		if err := a.httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
		close(errCh)
	}()

	select {
	case err := <-errCh:
		return err
	case <-ctx.Done():
		a.logger.Info("shutdown signal received, draining")
	}

	// Parent ctx is already cancelled (that's how we got here); use a fresh bounded ctx.
	shutdownCtx, cancel := context.WithTimeout(context.Background(), a.cfg.ShutdownTimeout)
	defer cancel()

	if err := a.httpServer.Shutdown(shutdownCtx); err != nil { //nolint:contextcheck // parent ctx already cancelled; shutdown uses fresh ctx
		a.logger.Error("http shutdown failed", "err", err)
	}
	if err := a.mongoClient.Disconnect(shutdownCtx); err != nil { //nolint:contextcheck // parent ctx already cancelled; disconnect uses fresh ctx
		a.logger.Error("mongo disconnect failed", "err", err)
	}
	a.logger.Info("server stopped cleanly")
	return nil
}
