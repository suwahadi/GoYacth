package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
	"github.com/prometheus/client_golang/prometheus/promhttp"

	"goyacht/internal/app"
	"goyacht/internal/platform/config"
	"goyacht/internal/platform/httpx"
	"goyacht/internal/platform/logging"
)

func main() {
	if err := run(); err != nil {
		slog.Error("api stopped", "error", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	logging.Setup("api", cfg.Env)
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	deps, err := app.NewDeps(ctx, cfg)
	if err != nil {
		return err
	}
	defer deps.Close()
	if err := deps.StartRiver(nil); err != nil {
		return err
	}
	if err := deps.S3.EnsureBuckets(ctx); err != nil {
		return err
	}

	reg := prometheus.NewRegistry()
	reg.MustRegister(collectors.NewGoCollector(), collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}))
	httpx.RegisterMetrics(reg)

	srv := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           app.NewRouter(deps, app.NewModules(deps, app.NewServices(deps, nil, nil))),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       60 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	metrics := &http.Server{Addr: cfg.MetricsAddr, Handler: promhttp.HandlerFor(reg, promhttp.HandlerOpts{}), ReadHeaderTimeout: 5 * time.Second}

	errCh := make(chan error, 2)
	go func() { errCh <- srv.ListenAndServe() }()
	go func() { errCh <- metrics.ListenAndServe() }()
	slog.Info("api listening", "addr", cfg.HTTPAddr)

	select {
	case <-ctx.Done():
	case err := <-errCh:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	}
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	_ = metrics.Shutdown(shutdownCtx)
	return srv.Shutdown(shutdownCtx)
}
