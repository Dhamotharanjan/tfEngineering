package impact

import (
	"context"
	"fmt"
	"path"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/neo4j/neo4j-go-driver/v5/neo4j"

	"github.com/acme/infragraph/worker/internal/config"
	"github.com/acme/infragraph/worker/internal/models"
	"github.com/acme/infragraph/worker/internal/store"
)

// Stage 6 (deterministic): Mandatory P0 impact analysis on release tag.
type Engine struct {
	Driver neo4j.DriverWithContext
	Store  *store.Postgres
	Loader *config.Loader
}

func (e *Engine) RunMandatoryAnalysis(ctx context.Context, upstreamRepoID, fromVersion, toVersion string, meta map[string]any) (*models.ImpactResult, error) {
	upstream, err := e.resolveUpstream(ctx, upstreamRepoID)
	if err != nil || upstream == nil {
		return nil, fmt.Errorf("upstream repo not subscribed: %s", upstreamRepoID)
	}

	consumers, err := e.findDownstreamConsumers(ctx, upstreamRepoID)
	if err != nil {
		return nil, err
	}

	changePlanID := fmt.Sprintf("cp-%s-%s", upstreamRepoID, strings.ReplaceAll(toVersion, ".", "-"))
	result := &models.ImpactResult{
		ChangePlanID:   changePlanID,
		UpstreamModule: upstream.GithubFullName,
		FromVersion:    fromVersion,
		ToVersion:      toVersion,
	}

	contractDiff, _ := DiffModuleVersions(e.Loader.Root, upstreamRepoID, upstream.GithubFullName, fromVersion, toVersion)
	if contractDiff == nil {
		empty := ContractDiff{Summary: map[string]int{}}
		contractDiff = &empty
	}

	phases := []map[string]any{
		{"phase": 1, "name": "Development", "days": "Day 1-2", "risk": "low"},
		{"phase": 2, "name": "Staging", "days": "Day 3-4", "risk": "medium"},
		{"phase": 3, "name": "Production", "days": "Day 5-7", "risk": "critical", "gates": []string{"CAB approval"}},
	}

	releaseNotes := strMeta(meta, "release_notes")
	releaseName := strMeta(meta, "release_name")
	tag := strMeta(meta, "tag")
	if tag == "" {
		tag = toVersion
	}
	if releaseNotes == "" {
		releaseNotes = fetchGitHubReleaseNotes(upstream.GithubFullName, tag)
	}

	breakingGlobal := contractDiff.Summary["breaking"] > 0
	impactReport := map[string]any{
		"contract_diff":  contractDiff,
		"breaking":       breakingGlobal,
		"from_version":   fromVersion,
		"to_version":     toVersion,
		"tag":            tag,
		"release_name":   releaseName,
		"release_notes":  releaseNotes,
		"upstream_repo":  upstreamRepoID,
		"generated_at":   NowISO(),
	}

	if err := e.Store.UpsertChangePlanWithReport(ctx, changePlanID, upstream.GithubFullName, fromVersion, toVersion, phases, impactReport); err != nil {
		return nil, err
	}

	allSubs, _ := e.Loader.LoadSubscriptions()
	subMap := map[string]models.RepoSubscription{}
	for _, s := range allSubs {
		subMap[s.ID] = s
	}

	matchHints := append([]string{upstreamRepoID, upstream.GithubFullName}, sourceMatchHints(e.Loader.Root, upstreamRepoID)...)

	for _, consumerID := range consumers {
		sub, ok := subMap[consumerID]
		if !ok || !sub.Subscribed || sub.Role != "downstream_consumer" {
			continue
		}
		pinned, signals := e.getConsumerModuleInfo(ctx, consumerID, upstreamRepoID)
		locations := e.Store.ListModuleLocations(ctx, consumerID, matchHints)
		strategy, reason := selectStrategy(signals, sub.ComplianceScope)

		breaking := []map[string]any{}
		if pinned != "" && pinned != toVersion && pinned != "unknown" {
			breaking = append(breaking, map[string]any{
				"type": "version_gap", "detail": fmt.Sprintf("%s -> %s", pinned, toVersion),
			})
		}
		for _, v := range contractDiff.Variables.Removed {
			breaking = append(breaking, map[string]any{"type": "removed_var", "name": v.Name, "detail": "variable removed"})
		}
		for _, m := range contractDiff.Variables.MadeMandatory {
			name, _ := m["name"].(string)
			breaking = append(breaking, map[string]any{"type": "made_mandatory", "name": name, "detail": "input now required"})
		}
		for _, c := range contractDiff.Variables.Changed {
			name, _ := c["name"].(string)
			rawChanges := c["changes"]
			var changeList []string
			switch v := rawChanges.(type) {
			case []string:
				changeList = v
			case []any:
				for _, x := range v {
					if s, ok := x.(string); ok {
						changeList = append(changeList, s)
					}
				}
			}
			for _, ch := range changeList {
				if ch == "type" {
					breaking = append(breaking, map[string]any{"type": "type_change", "name": name, "detail": "variable type changed"})
				}
			}
		}
		for _, v := range contractDiff.Variables.Added {
			if isMandatory(v) {
				breaking = append(breaking, map[string]any{"type": "new_required", "name": v.Name, "detail": "new mandatory variable"})
			}
		}

		if len(breaking) > 0 {
			breakingGlobal = true
		}

		locMaps := make([]map[string]any, 0, len(locations))
		for _, loc := range locations {
			dir := path.Dir(loc.File)
			if loc.StackFile != "" {
				dir = path.Dir(loc.StackFile)
			}
			file := loc.File
			if file == "" {
				file = loc.StackFile
			}
			locMaps = append(locMaps, map[string]any{
				"file":       file,
				"directory":  dir,
				"stack_file": loc.StackFile,
				"line":       loc.Line,
				"ref":        loc.Ref,
				"source":     loc.ModuleSource,
			})
		}

		plan := models.RolloutPlan{
			ID:               uuid.New().String(),
			DownstreamRepo:   sub.GithubFullName,
			DownstreamRepoID: consumerID,
			PinnedVersion:    pinned,
			TargetVersion:    toVersion,
			VersionGap:       fmt.Sprintf("%s -> %s", pinned, toVersion),
			Strategy:         strategy,
			StrategyReason:   reason,
			Rollback:         fmt.Sprintf("Revert module ref to %s across all stacks", fromVersion),
			BreakingChanges:  breaking,
			Locations:        locMaps,
			Phases: []map[string]any{
				{"step": 1, "action": fmt.Sprintf("Bump module ref to %s in terragrunt.hcl", toVersion), "duration": "30 min"},
				{"step": 2, "action": "terragrunt run-all plan — validate outputs", "duration": "1 hr"},
				{"step": 3, "action": fmt.Sprintf("Apply using %s strategy", strategy), "duration": "2-48 hr"},
			},
		}
		if err := e.Store.InsertRolloutPlan(ctx, changePlanID, &plan); err != nil {
			return nil, err
		}
		result.RolloutPlans = append(result.RolloutPlans, plan)
		result.AffectedRepos = append(result.AffectedRepos, consumerID)
	}

	impactReport["breaking"] = breakingGlobal
	impactReport["affected_count"] = len(result.AffectedRepos)
	_ = e.Store.UpdateChangePlanImpactReport(ctx, changePlanID, impactReport)
	result.ImpactReport = impactReport
	result.Breaking = breakingGlobal

	return result, nil
}

func (e *Engine) resolveUpstream(ctx context.Context, upstreamRepoID string) (*models.RepoSubscription, error) {
	if e.Store != nil {
		sub, err := e.Store.GetSubscribedRepo(ctx, upstreamRepoID)
		if err != nil {
			return nil, err
		}
		if sub != nil {
			return sub, nil
		}
	}
	return e.Loader.GetSubscription(upstreamRepoID)
}

func strMeta(meta map[string]any, key string) string {
	if meta == nil {
		return ""
	}
	if v, ok := meta[key].(string); ok {
		return strings.TrimSpace(v)
	}
	return ""
}

func sourceMatchHints(root, upstreamRepoID string) []string {
	seed, err := loadContractsSeed(root)
	if err != nil {
		return nil
	}
	mod := findModule(seed, upstreamRepoID, "")
	if mod == nil {
		return nil
	}
	return mod.SourceMatch
}

func (e *Engine) findDownstreamConsumers(ctx context.Context, upstreamRepoID string) ([]string, error) {
	session := e.Driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeRead})
	defer session.Close(ctx)

	result, err := session.ExecuteRead(ctx, func(tx neo4j.ManagedTransaction) (any, error) {
		res, err := tx.Run(ctx, `
			MATCH (upstream:Repository {id: $upstream})-[:CONTAINS_MODULE|HAS_STACK]->()
			MATCH (consumer:Repository {role: 'downstream_consumer'})-[:HAS_STACK]->(st:Stack)-[:REFERENCES_MODULE]->(mod:Module)
			WHERE consumer.id <> $upstream
			RETURN DISTINCT consumer.id AS id
		`, map[string]any{"upstream": upstreamRepoID})
		if err != nil {
			return nil, err
		}
		var ids []string
		for res.Next(ctx) {
			if id, ok := res.Record().Get("id"); ok {
				ids = append(ids, id.(string))
			}
		}
		return ids, res.Err()
	})
	if err != nil {
		subs, loadErr := e.Loader.LoadSubscriptions()
		if loadErr != nil {
			return nil, err
		}
		var ids []string
		for _, s := range subs {
			if s.Subscribed && s.Role == "downstream_consumer" {
				ids = append(ids, s.ID)
			}
		}
		return ids, nil
	}
	return result.([]string), nil
}

func (e *Engine) getConsumerModuleInfo(ctx context.Context, consumerID, upstreamID string) (string, []string) {
	session := e.Driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeRead})
	defer session.Close(ctx)
	pinned := "unknown"
	var signals []string
	_, _ = session.ExecuteRead(ctx, func(tx neo4j.ManagedTransaction) (any, error) {
		res, err := tx.Run(ctx, `
			MATCH (r:Repository {id: $consumer})-[:HAS_STACK]->(st:Stack)-[ref:REFERENCES_MODULE]->(mod:Module)
			RETURN ref.ref AS pinned, st.source AS source
			LIMIT 5
		`, map[string]any{"consumer": consumerID})
		if err != nil {
			return nil, err
		}
		for res.Next(ctx) {
			if p, ok := res.Record().Get("pinned"); ok && p != nil {
				pinned = p.(string)
			}
		}
		return nil, res.Err()
	})
	return pinned, signals
}

func selectStrategy(signals []string, compliance []string) (string, string) {
	for _, c := range compliance {
		if c == "pci_dss" {
			return "phased_cab", "PCI scope requires CAB gate"
		}
	}
	for _, s := range signals {
		switch s {
		case "canary":
			return "canary", "ALB traffic_distribution pattern detected"
		case "rolling":
			return "rolling", "EKS/ASG rolling update pattern detected"
		case "maintenance_window":
			return "maintenance_window", "RDS apply_immediately=false pattern"
		}
	}
	return "direct_apply", "Low-risk dev/staging or no rollout signals"
}

func NowISO() string {
	return time.Now().UTC().Format(time.RFC3339)
}
