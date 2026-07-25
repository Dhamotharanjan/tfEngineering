package pipeline

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"time"

	"github.com/neo4j/neo4j-go-driver/v5/neo4j"

	"github.com/acme/infragraph/worker/internal/config"
	"github.com/acme/infragraph/worker/internal/models"
	"github.com/acme/infragraph/worker/internal/stages/acquisition"
	"github.com/acme/infragraph/worker/internal/stages/delta"
	"github.com/acme/infragraph/worker/internal/stages/enrich"
	"github.com/acme/infragraph/worker/internal/stages/graph"
	"github.com/acme/infragraph/worker/internal/stages/impact"
	"github.com/acme/infragraph/worker/internal/stages/intake"
	"github.com/acme/infragraph/worker/internal/stages/parse"
	"github.com/acme/infragraph/worker/internal/store"
)

type Runner struct {
	Root   string
	Loader *config.Loader
	Store  *store.Postgres
	Graph  *graph.Writer
	Impact *impact.Engine
	Enqueue func(job *models.Job) error // optional: enqueue follow-up jobs (impact hint)
}

type scanMode string

const (
	modeFull        scanMode = "full"
	modeIncremental scanMode = "incremental"
	modeReconcile   scanMode = "reconcile"
)

func (r *Runner) RunFullScan(ctx context.Context, jobID, repoID string) error {
	return r.runScan(ctx, jobID, repoID, modeFull, nil)
}

func (r *Runner) RunIncrementalScan(ctx context.Context, jobID, repoID string, payload map[string]any) error {
	return r.runScan(ctx, jobID, repoID, modeIncremental, payload)
}

func (r *Runner) RunReconcileScan(ctx context.Context, jobID, repoID string) error {
	return r.runScan(ctx, jobID, repoID, modeReconcile, map[string]any{"trigger": "reconcile"})
}

func (r *Runner) runScan(ctx context.Context, jobID, repoID string, mode scanMode, payload map[string]any) error {
	if err := RefuseHotScanTrigger(payload); err != nil {
		return err
	}

	sub, err := intake.ValidateSubscription(ctx, r.Loader, r.Store, repoID)
	if err != nil {
		return err
	}

	preferredSHA := strPayload(payload, "head_sha")
	acq, err := acquisition.AcquireRepo(sub, r.Loader.ResolveRepoPath(sub), r.Root, &acquisition.AcquireOptions{
		PreferredSHA: preferredSHA,
		ForceFull:    mode != modeIncremental,
	})
	if err != nil {
		return fmt.Errorf("stage2 acquisition: %w", err)
	}
	_ = r.Store.RecordScanRunDetails(ctx, jobID, repoID, "acquisition", "completed", 0, 0, acq.ArtifactPath, map[string]any{
		"mode": mode, "head_sha": acq.HeadSHA, "is_git": acq.IsGit, "files": acq.FileCount,
	})

	profile, err := r.Loader.LoadScanProfileByID(sub.ScanProfile)
	if err != nil {
		log.Printf("scan profile warning repo=%s profile=%s: %v", repoID, sub.ScanProfile, err)
	}

	fromSHA := strPayload(payload, "before_sha")
	if fromSHA == "" {
		fromSHA, _ = r.Store.GetLastScannedSHA(ctx, repoID)
	}
	toSHA := acq.HeadSHA
	if preferredSHA != "" {
		toSHA = preferredSHA
	}

	var (
		parsed       *models.ParseResult
		filesTouched []string
		parseStart   = time.Now()
	)

	useIncremental := mode == modeIncremental && profile != nil && profile.IncrementalOnlyOnPush()
	if useIncremental && acq.IsGit && fromSHA != "" && toSHA != "" && fromSHA != toSHA {
		changed, derr := acquisition.DiffNames(acq.SourceDir, fromSHA, toSHA)
		if derr != nil {
			log.Printf("delta diff warning repo=%s: %v — falling back to full parse", repoID, derr)
			useIncremental = false
		} else {
			allFiles := listIaCRel(acq.WorkDir)
			filesTouched = delta.FilterAndClose(changed, delta.DefaultFilters(profile), allFiles)
			if len(filesTouched) == 0 {
				log.Printf("incremental scan repo=%s: no IaC paths in diff — watermark only", repoID)
				_ = r.Store.UpdateSubscriptionScanWatermark(ctx, repoID, "completed", 0, toSHA, acq.Ref, string(mode), map[string]any{
					"mode": mode, "from_sha": fromSHA, "to_sha": toSHA, "files_touched": 0, "skipped_parse": true,
				})
				_ = r.Store.InsertScanMetrics(ctx, repoID, "incremental_scan", string(mode), fromSHA, toSHA, 0, 0, 0, coalesceCount(payload))
				return nil
			}
			parsed, err = parse.ParseRepoFiltered(acq.WorkDir, repoID, profile, filesTouched)
			if err != nil {
				return fmt.Errorf("stage3 incremental parse: %w", err)
			}
		}
	}

	if !useIncremental || parsed == nil {
		mode = modeFull
		if payload != nil && strPayload(payload, "trigger") == "reconcile" {
			mode = modeReconcile
		}
		parsed, err = parse.ParseRepoWithProfile(acq.WorkDir, repoID, profile)
		if err != nil {
			return fmt.Errorf("stage3 parse: %w", err)
		}
		filesTouched = listIaCRel(acq.WorkDir)
	}
	parseMs := int(time.Since(parseStart).Milliseconds())
	_ = r.Store.RecordScanRunDetails(ctx, jobID, repoID, "parse", "completed", len(parsed.Resources), len(parsed.Modules), acq.ArtifactPath, map[string]any{
		"mode": mode, "from_sha": fromSHA, "to_sha": toSHA, "files_touched": filesTouched, "parse_ms": parseMs,
	})

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
	// PersistParseResult already marks the BeginScanRun("persist") row completed — do not insert a second persist stage.

	graphStart := time.Now()
	stats, err := r.Graph.Write(ctx, sub, parsed, subs)
	if err != nil {
		return fmt.Errorf("stage5 graph: %w", err)
	}
	graphMs := int(time.Since(graphStart).Milliseconds())
	_ = r.Store.RecordScanRunDetails(ctx, jobID, repoID, "graph", "completed", stats.Nodes, stats.Edges, "", map[string]any{
		"mode": mode, "graph_ms": graphMs, "from_sha": fromSHA, "to_sha": toSHA,
	})

	for _, sig := range parsed.EOLSignals {
		_ = r.Store.InsertEOLRisk(ctx, repoID, sig)
	}

	scanStats := map[string]any{
		"mode":          mode,
		"from_sha":      fromSHA,
		"to_sha":        toSHA,
		"files_touched": len(filesTouched),
		"parse_ms":      parseMs,
		"graph_ms":      graphMs,
	}
	_ = r.Store.UpdateSubscriptionScanWatermark(ctx, repoID, "completed", stats.Nodes, toSHA, acq.Ref, string(mode), scanStats)
	_ = r.Store.InsertScanMetrics(ctx, repoID, string(mode)+"_scan", string(mode), fromSHA, toSHA, len(filesTouched), parseMs, graphMs, coalesceCount(payload))
	_ = r.Store.Audit(ctx, "system", fmt.Sprintf("%s scan completed", mode), repoID)

	go notifyAIIngest(context.Background(), repoID, map[string]any{
		"repo_id":   repoID,
		"resources": parsed.Resources,
		"stacks":    parsed.Stacks,
		"mode":      mode,
	})

	// Differentiator: module interface change → impact hint for module_source repos
	if sub.Role == "module_source" && delta.InterfaceTouching(filesTouched) && r.Enqueue != nil {
		_ = r.Enqueue(&models.Job{
			Type:     "module_impact_hint",
			Priority: "P1",
			RepoID:   repoID,
			Payload: map[string]any{
				"trigger":   "interface_change",
				"from_sha":  fromSHA,
				"to_sha":    toSHA,
				"files":     filesTouched,
				"hint_only": true,
			},
		})
		// Pattern invalidate signal for AI service (best-effort HTTP via existing notify)
		go notifyPatternInvalidate(context.Background(), repoID, filesTouched)
	}

	log.Printf("scan complete mode=%s repo=%s nodes=%d edges=%d files=%d parse_ms=%d", mode, repoID, stats.Nodes, stats.Edges, len(filesTouched), parseMs)
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
	meta := map[string]any{
		"tag":           strPayload(payload, "tag"),
		"release_name":  strPayload(payload, "release_name"),
		"release_notes": strPayload(payload, "release_notes"),
	}
	if meta["tag"] == "" {
		meta["tag"] = to
	}
	result, err := r.Impact.RunMandatoryAnalysis(ctx, upstreamRepoID, from, to, meta)
	if err != nil {
		return err
	}
	_ = r.Store.RecordScanRun(ctx, jobID, upstreamRepoID, "impact", "completed", len(result.AffectedRepos), len(result.RolloutPlans), "")
	_ = r.Store.Audit(ctx, "system", "Mandatory impact analysis completed", fmt.Sprintf("%s %s->%s", upstreamRepoID, from, to))
	log.Printf("impact analysis upstream=%s affected=%d plans=%d", upstreamRepoID, len(result.AffectedRepos), len(result.RolloutPlans))
	return nil
}

// RunModuleImpactHint is a lightweight differentiator: re-run impact when module interface files change (no tag required).
func (r *Runner) RunModuleImpactHint(ctx context.Context, jobID, upstreamRepoID string, payload map[string]any) error {
	to := strPayload(payload, "to_sha")
	if to == "" {
		to = "HEAD"
	}
	from := strPayload(payload, "from_sha")
	if from == "" {
		from = "previous"
	}
	result, err := r.Impact.RunMandatoryAnalysis(ctx, upstreamRepoID, from, to, map[string]any{
		"tag": to, "release_notes": "", "release_name": "module interface change hint",
	})
	if err != nil {
		log.Printf("module_impact_hint soft-fail upstream=%s: %v", upstreamRepoID, err)
		_ = r.Store.RecordScanRunDetails(ctx, jobID, upstreamRepoID, "impact_hint", "completed", 0, 0, "", map[string]any{
			"soft_fail": err.Error(), "files": payload["files"],
		})
		return nil
	}
	_ = r.Store.RecordScanRunDetails(ctx, jobID, upstreamRepoID, "impact_hint", "completed", len(result.AffectedRepos), len(result.RolloutPlans), "", map[string]any{
		"hint_only": true, "files": payload["files"],
	})
	_ = r.Store.Audit(ctx, "system", "Module interface impact hint completed", upstreamRepoID)
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
	case "full_scan":
		return r.RunFullScan(ctx, jobID, job.RepoID)
	case "incremental_scan":
		return r.RunIncrementalScan(ctx, jobID, job.RepoID, job.Payload)
	case "reconcile_scan":
		return r.RunReconcileScan(ctx, jobID, job.RepoID)
	case "mandatory_impact_analysis":
		return r.RunMandatoryImpact(ctx, jobID, job.RepoID, job.Payload)
	case "module_impact_hint":
		return r.RunModuleImpactHint(ctx, jobID, job.RepoID, job.Payload)
	case "pr_impact_query", "tag_impact_query":
		return fmt.Errorf("job type %s is HOT and must run in the API ImpactLoop (refusing worker graph path)", job.Type)
	case "clear_artifacts":
		return r.ClearArtifacts(ctx)
	default:
		return fmt.Errorf("unknown job type: %s", job.Type)
	}
}

func strPayload(payload map[string]any, key string) string {
	if payload == nil {
		return ""
	}
	v, _ := payload[key].(string)
	return v
}

func coalesceCount(payload map[string]any) int {
	if payload == nil {
		return 1
	}
	switch v := payload["coalesce_count"].(type) {
	case float64:
		return int(v)
	case int:
		return v
	default:
		return 1
	}
}

func listIaCRel(workDir string) []string {
	var out []string
	_ = filepath.Walk(workDir, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			if info != nil && info.IsDir() && (info.Name() == ".git" || info.Name() == ".terraform") {
				return filepath.SkipDir
			}
			return err
		}
		ext := filepath.Ext(info.Name())
		if ext != ".tf" && ext != ".hcl" {
			return nil
		}
		rel, _ := filepath.Rel(workDir, path)
		out = append(out, filepath.ToSlash(rel))
		return nil
	})
	return out
}
