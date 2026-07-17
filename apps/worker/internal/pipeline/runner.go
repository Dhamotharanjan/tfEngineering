package pipeline

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"

	"github.com/neo4j/neo4j-go-driver/v5/neo4j"

	"github.com/acme/infragraph/worker/internal/config"
	"github.com/acme/infragraph/worker/internal/models"
	"github.com/acme/infragraph/worker/internal/stages/acquisition"
	"github.com/acme/infragraph/worker/internal/stages/enrich"
	"github.com/acme/infragraph/worker/internal/stages/graph"
	"github.com/acme/infragraph/worker/internal/stages/impact"
	"github.com/acme/infragraph/worker/internal/stages/intake"
	"github.com/acme/infragraph/worker/internal/stages/parse"
	"github.com/acme/infragraph/worker/internal/store"
)

type Runner struct {
	Root    string
	Loader  *config.Loader
	Store   *store.Postgres
	Graph   *graph.Writer
	Impact  *impact.Engine
}

func (r *Runner) RunFullScan(ctx context.Context, jobID, repoID string) error {
	sub, err := intake.ValidateSubscription(r.Loader, repoID)
	if err != nil {
		return err
	}

	acq, err := acquisition.Acquire(sub, r.Loader.ResolveRepoPath(sub), r.Root)
	if err != nil {
		return fmt.Errorf("stage2 acquisition: %w", err)
	}
	_ = r.Store.RecordScanRun(ctx, jobID, repoID, "acquisition", "completed", 0, 0, acq.ArtifactPath)

	profile, err := r.Loader.LoadScanProfileByID(sub.ScanProfile)
	if err != nil {
		log.Printf("scan profile warning repo=%s profile=%s: %v", repoID, sub.ScanProfile, err)
	}
	parsed, err := parse.ParseRepoWithProfile(acq.WorkDir, repoID, profile)
	if err != nil {
		return fmt.Errorf("stage3 parse: %w", err)
	}
	_ = r.Store.RecordScanRun(ctx, jobID, repoID, "parse", "completed", len(parsed.Resources), len(parsed.Modules), acq.ArtifactPath)

	reg, _ := r.Loader.LoadAWSRegistry()
	parsed = enrich.Enrich(parsed, reg, profile)
	_ = r.Store.RecordScanRun(ctx, jobID, repoID, "enrich", "completed", 0, 0, "")

	subs, _ := r.Loader.LoadSubscriptions()
	scanRunID, err := r.Store.BeginScanRun(ctx, jobID, repoID, "persist")
	if err != nil {
		return fmt.Errorf("stage4 persist begin: %w", err)
	}
	if err := r.Store.PersistParseResult(ctx, scanRunID, repoID, parsed, subs); err != nil {
		return fmt.Errorf("stage4 persist: %w", err)
	}
	_ = r.Store.RecordScanRun(ctx, jobID, repoID, "persist", "completed", len(parsed.Resources), len(parsed.Modules), "")

	stats, err := r.Graph.Write(ctx, sub, parsed, subs)
	if err != nil {
		return fmt.Errorf("stage5 graph: %w", err)
	}
	_ = r.Store.RecordScanRun(ctx, jobID, repoID, "graph", "completed", stats.Nodes, stats.Edges, "")

	for _, sig := range parsed.EOLSignals {
		_ = r.Store.InsertEOLRisk(ctx, repoID, sig)
	}

	_ = r.Store.UpdateSubscriptionScan(ctx, repoID, "completed", stats.Nodes)
	_ = r.Store.Audit(ctx, "system", "Full scan completed", repoID)
	go notifyAIIngest(context.Background(), repoID, map[string]any{
		"repo_id":   repoID,
		"resources": parsed.Resources,
		"stacks":    parsed.Stacks,
	})
	log.Printf("scan complete repo=%s nodes=%d edges=%d", repoID, stats.Nodes, stats.Edges)
	return nil
}

func (r *Runner) RunMandatoryImpact(ctx context.Context, jobID, upstreamRepoID string, payload map[string]any) error {
	from, _ := payload["from_version"].(string)
	to, _ := payload["to_version"].(string)
	if to == "" {
		to = "v3.0.0"
	}
	if from == "" {
		from = "v2.4.2"
	}
	result, err := r.Impact.RunMandatoryAnalysis(ctx, upstreamRepoID, from, to)
	if err != nil {
		return err
	}
	_ = r.Store.RecordScanRun(ctx, jobID, upstreamRepoID, "impact", "completed", len(result.AffectedRepos), len(result.RolloutPlans), "")
	_ = r.Store.Audit(ctx, "system", "Mandatory impact analysis completed", fmt.Sprintf("%s %s->%s", upstreamRepoID, from, to))
	log.Printf("impact analysis upstream=%s affected=%d plans=%d", upstreamRepoID, len(result.AffectedRepos), len(result.RolloutPlans))
	return nil
}

func (r *Runner) Bootstrap(ctx context.Context) error {
	schema := filepath.Join(r.Root, "config", "postgres", "schema.sql")
	if err := r.Store.InitSchema(ctx, schema); err != nil {
		log.Printf("schema init warning: %v", err)
	}
	repos, err := r.Loader.LoadSubscriptions()
	if err != nil {
		return err
	}
	return r.Store.SyncSubscriptions(ctx, repos)
}

func NewRunner(root string, pg *store.Postgres, driver neo4j.DriverWithContext) *Runner {
	loader := &config.Loader{Root: root}
	return &Runner{
		Root:   root,
		Loader: loader,
		Store:  pg,
		Graph:  &graph.Writer{Driver: driver},
		Impact: &impact.Engine{Driver: driver, Store: pg, Loader: loader},
	}
}

func (r *Runner) ClearArtifacts(ctx context.Context) error {
	artifactsDir := filepath.Join(r.Root, "data", "artifacts")
	entries, err := os.ReadDir(artifactsDir)
	if err != nil {
		if os.IsNotExist(err) {
			log.Printf("artifacts directory does not exist, nothing to clear: %s", artifactsDir)
			return nil
		}
		return fmt.Errorf("read artifacts dir: %w", err)
	}
	for _, entry := range entries {
		path := filepath.Join(artifactsDir, entry.Name())
		if err := os.RemoveAll(path); err != nil {
			return fmt.Errorf("remove %s: %w", path, err)
		}
	}
	log.Printf("cleared artifacts directory: %s (%d entries removed)", artifactsDir, len(entries))
	return nil
}

func (r *Runner) ProcessJob(ctx context.Context, job *models.Job) error {
	jobID := job.ID
	if jobID == "" {
		jobID = "inline"
	}
	switch job.Type {
	case "full_scan", "incremental_scan":
		return r.RunFullScan(ctx, jobID, job.RepoID)
	case "mandatory_impact_analysis":
		return r.RunMandatoryImpact(ctx, jobID, job.RepoID, job.Payload)
	case "clear_artifacts":
		return r.ClearArtifacts(ctx)
	default:
		return fmt.Errorf("unknown job type: %s", job.Type)
	}
}
