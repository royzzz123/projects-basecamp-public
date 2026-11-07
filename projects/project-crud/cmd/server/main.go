// cmd/server/main.go — thin entrypoint. Only wires deps and starts the server.
// Anything more substantial belongs in internal/server.
package main

import (
	"context"
	"os"
	"os/signal"
	"syscall"

	"github.com/OnFinance/project-crud/internal/config"
	"github.com/OnFinance/project-crud/internal/observability"
	"github.com/OnFinance/project-crud/internal/server"
)

// Populated via -ldflags at build time.
var (
	version   = "dev"
	commit    = "unknown"
	buildTime = "unknown"
)

func main() {
	if err := run(); err != nil {
		os.Exit(1)
	}
}

func run() error {
	observability.Version = version
	observability.Commit = commit
	observability.BuildTime = buildTime

	cfg := config.MustLoad()
	logger := observability.NewLogger(cfg)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	app, err := server.New(ctx, cfg, logger)
	if err != nil {
		logger.Error("init failed", "err", err)
		return err
	}

	if err := app.Run(ctx); err != nil {
		logger.Error("server exited with error", "err", err)
		return err
	}
	return nil
}
