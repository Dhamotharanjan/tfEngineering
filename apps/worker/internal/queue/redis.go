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
