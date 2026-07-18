package queue

import (
	"context"
	"encoding/json"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/acme/infragraph/worker/internal/models"
)

const QueueKey = "infragraph:jobs"

type Redis struct {
	Client *redis.Client
}

func NewRedis(url string) (*Redis, error) {
	opt, err := redis.ParseURL(url)
	if err != nil {
		opt = &redis.Options{Addr: "localhost:6379"}
	}
	return &Redis{Client: redis.NewClient(opt)}, nil
}

func (r *Redis) Enqueue(ctx context.Context, job models.Job) error {
	if job.ID == "" {
		job.ID = time.Now().UTC().Format("job-20060102T150405.000")
	}
	data, err := json.Marshal(job)
	if err != nil {
		return err
	}
	return r.Client.LPush(ctx, QueueKey, data).Err()
}

// EnqueueCoalesced merges bursty incremental_scan jobs for the same repo within windowSec.
// Returns the job that was enqueued (or the existing pending coalesced job metadata).
func (r *Redis) EnqueueCoalesced(ctx context.Context, job models.Job, windowSec int) (models.Job, int, error) {
	if windowSec <= 0 {
		windowSec = 30
	}
	if job.Type != "incremental_scan" {
		err := r.Enqueue(ctx, job)
		return job, 1, err
	}
	key := "infragraph:coalesce:" + job.RepoID
	count, err := r.Client.Incr(ctx, key).Result()
	if err != nil {
		_ = r.Enqueue(ctx, job)
		return job, 1, nil
	}
	if count == 1 {
		r.Client.Expire(ctx, key, time.Duration(windowSec)*time.Second)
		if job.Payload == nil {
			job.Payload = map[string]any{}
		}
		job.Payload["coalesced"] = true
		job.Payload["coalesce_count"] = 1
		err = r.Enqueue(ctx, job)
		return job, 1, err
	}
	// Subsequent pushes within window: bump counter; skip duplicate enqueue (first job will scan latest HEAD).
	if job.Payload == nil {
		job.Payload = map[string]any{}
	}
	job.Payload["coalesced"] = true
	job.Payload["coalesce_count"] = int(count)
	job.Payload["superseded"] = true
	return job, int(count), nil
}

func (r *Redis) Dequeue(ctx context.Context, timeout time.Duration) (*models.Job, error) {
	res, err := r.Client.BRPop(ctx, timeout, QueueKey).Result()
	if err != nil {
		return nil, err
	}
	if len(res) < 2 {
		return nil, nil
	}
	var job models.Job
	if err := json.Unmarshal([]byte(res[1]), &job); err != nil {
		return nil, err
	}
	return &job, nil
}
