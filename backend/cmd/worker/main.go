package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/davidbyttow/govips/v2/vips"

	"goyacht/internal/app"
	"goyacht/internal/platform/config"
	"goyacht/internal/platform/logging"
)

func main() {
	if err := run(); err != nil {
		slog.Error("worker stopped", "error", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	logging.Setup("worker", cfg.Env)
	vips.LoggingSettings(nil, vips.LogLevelWarning)
	if err := vips.Startup(&vips.Config{ConcurrencyLevel: 2, MaxCacheMem: 64 << 20}); err != nil {
		return err
	}
	defer vips.Shutdown()

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	deps, err := app.NewDeps(ctx, cfg)
	if err != nil {
		return err
	}
	defer deps.Close()
	if err := deps.Store.EnsureBuckets(ctx); err != nil {
		return err
	}
	if err := deps.StartRiver(app.WorkerConfig(deps)); err != nil {
		return err
	}
	if err := deps.River.Start(ctx); err != nil {
		return err
	}

	health := &http.Server{Addr: ":8081", ReadHeaderTimeout: 5 * time.Second, Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		pingCtx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if err := deps.Pool.Ping(pingCtx); err != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusOK)
	})}
	go func() { _ = health.ListenAndServe() }()
	slog.Info("worker started")

	<-ctx.Done()
	slog.Info("worker stopping")
	stopCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	_ = health.Shutdown(stopCtx)
	return deps.River.Stop(stopCtx)
}
