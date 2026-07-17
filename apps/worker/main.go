package main

import (
	"context"
	"log"
	"os"
	"time"

	"github.com/neo4j/neo4j-go-driver/v5/neo4j"

	"github.com/acme/infragraph/worker/internal/models"
	"github.com/acme/infragraph/worker/internal/pipeline"
	"github.com/acme/infragraph/worker/internal/queue"
	"github.com/acme/infragraph/worker/internal/store"
)

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func main() {
	root := env("PROJECT_ROOT", "/app")
	neo4jURI := env("NEO4J_URI", "bolt://localhost:7687")
	neo4jUser := env("NEO4J_USER", "neo4j")
	neo4jPass := env("NEO4J_PASSWORD", "neo4j123")
	pgDSN := env("POSTGRES_DSN", "postgresql://tfengineering:tfengineering123@localhost:5432/tfengineering")
	redisURL := env("REDIS_URL", "redis://localhost:6379/0")
	bootstrap := env("BOOTSTRAP_ON_START", "true") == "true"
	scanOnStart := env("SCAN_ALL_ON_START", "false") == "true"

	ctx := context.Background()
	pg, err := store.Connect(ctx, pgDSN)
	if err != nil {
		log.Fatalf("postgres: %v", err)
	}
	defer pg.Pool.Close()

	driver, err := neo4j.NewDriverWithContext(neo4jURI, neo4j.BasicAuth(neo4jUser, neo4jPass, ""))
	if err != nil {
		log.Fatalf("neo4j: %v", err)
	}
	defer driver.Close(ctx)

	runner := pipeline.NewRunner(root, pg, driver)
	if bootstrap {
		if err := runner.Bootstrap(ctx); err != nil {
			log.Printf("bootstrap: %v", err)
		}
	}

	rq, err := queue.NewRedis(redisURL)
	if err != nil {
		log.Fatalf("redis: %v", err)
	}

	if scanOnStart {
		repos, _ := runner.Loader.LoadSubscriptions()
		for _, r := range repos {
			if r.Subscribed {
				jobID, _ := pg.CreateScanJob(ctx, "full_scan", "P2", r.ID, map[string]any{"trigger": "startup"})
				if err := runner.RunFullScan(ctx, jobID, r.ID); err != nil {
					log.Printf("startup scan %s: %v", r.ID, err)
					_ = pg.CompleteScanJob(ctx, jobID, "failed", err.Error())
				} else {
					_ = pg.CompleteScanJob(ctx, jobID, "completed", "")
				}
			}
		}
	}

	log.Println("InfraGraph worker listening on queue", queue.QueueKey)
	for {
		job, err := rq.Dequeue(ctx, 5*time.Second)
		if err != nil {
			if err.Error() == "redis: nil" {
				continue
			}
			log.Printf("dequeue: %v", err)
			time.Sleep(time.Second)
			continue
		}
		if job == nil {
			continue
		}
		log.Printf("processing job type=%s repo=%s priority=%s", job.Type, job.RepoID, job.Priority)
		if job.Type == "clear_artifacts" {
			if err := runner.ProcessJob(ctx, job); err != nil {
				log.Printf("clear_artifacts failed: %v", err)
			}
			continue
		}
		jobID, _ := pg.CreateScanJob(ctx, job.Type, job.Priority, job.RepoID, job.Payload)
		if err := runner.ProcessJob(ctx, job); err != nil {
			log.Printf("job failed: %v", err)
			_ = pg.CompleteScanJob(ctx, jobID, "failed", err.Error())
			continue
		}
		_ = pg.CompleteScanJob(ctx, jobID, "completed", "")
	}
}

// Ensure models package is referenced for job unmarshaling edge cases
var _ = models.Job{}
