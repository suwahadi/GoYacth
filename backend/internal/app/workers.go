package app

import (
	"context"
	"time"

	"github.com/riverqueue/river"

	"goyacht/internal/modules/media"
	"goyacht/internal/platform/db/dbq"
	"goyacht/internal/platform/jobs"
)

type processMediaWorker struct {
	river.WorkerDefaults[jobs.ProcessMedia]
	svc *media.Service
}

func (w *processMediaWorker) Work(ctx context.Context, job *river.Job[jobs.ProcessMedia]) error {
	return w.svc.Process(ctx, job.Args.MediaID)
}

func (w *processMediaWorker) Timeout(*river.Job[jobs.ProcessMedia]) time.Duration {
	return 2 * time.Minute
}

type deleteMediaWorker struct {
	river.WorkerDefaults[jobs.DeleteMedia]
	svc *media.Service
}

func (w *deleteMediaWorker) Work(ctx context.Context, job *river.Job[jobs.DeleteMedia]) error {
	return w.svc.DeleteUnused(ctx, job.Args.MediaIDs)
}

type cleanupMediaWorker struct {
	river.WorkerDefaults[jobs.CleanupMedia]
	svc *media.Service
}

func (w *cleanupMediaWorker) Work(ctx context.Context, _ *river.Job[jobs.CleanupMedia]) error {
	return w.svc.CleanupOrphans(ctx)
}

type housekeepingWorker struct {
	river.WorkerDefaults[jobs.CleanupHousekeeping]
	q *dbq.Queries
}

func (w *housekeepingWorker) Work(ctx context.Context, _ *river.Job[jobs.CleanupHousekeeping]) error {
	if _, err := w.q.DeleteExpiredSessions(ctx); err != nil {
		return err
	}
	if _, err := w.q.DeleteExpiredOAuthStates(ctx); err != nil {
		return err
	}
	if _, err := w.q.DeleteExpiredEmailTokens(ctx); err != nil {
		return err
	}
	_, err := w.q.DeleteOldIdempotencyKeys(ctx)
	return err
}

func periodic(every time.Duration, args river.JobArgs) *river.PeriodicJob {
	return river.NewPeriodicJob(river.PeriodicInterval(every), func() (river.JobArgs, *river.InsertOpts) {
		return args, nil
	}, &river.PeriodicJobOpts{RunOnStart: true})
}

// WorkerConfig builds the River configuration with every worker and schedule (PRD section 15.2).
func WorkerConfig(d *Deps, s *Services) *river.Config {
	workers := river.NewWorkers()
	mediaSvc := s.Media
	river.AddWorker(workers, &processMediaWorker{svc: mediaSvc})
	river.AddWorker(workers, &deleteMediaWorker{svc: mediaSvc})
	river.AddWorker(workers, &cleanupMediaWorker{svc: mediaSvc})
	river.AddWorker(workers, &housekeepingWorker{q: dbq.New(d.Pool)})

	periodicJobs := []*river.PeriodicJob{
		periodic(24*time.Hour, jobs.CleanupMedia{}),
		periodic(6*time.Hour, jobs.CleanupHousekeeping{}),
	}
	periodicJobs = append(periodicJobs, registerFeatureWorkers(d, workers, s)...)

	return &river.Config{
		Queues: map[string]river.QueueConfig{
			jobs.QueueDefault: {MaxWorkers: 10},
			jobs.QueueMedia:   {MaxWorkers: 2},
			jobs.QueueEmail:   {MaxWorkers: 5},
		},
		Workers:      workers,
		PeriodicJobs: periodicJobs,
	}
}
