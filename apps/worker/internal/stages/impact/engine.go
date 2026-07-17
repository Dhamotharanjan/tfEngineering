package impact

import (
	"context"
	"fmt"
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

func (e *Engine) RunMandatoryAnalysis(ctx context.Context, upstreamRepoID, fromVersion, toVersion string) (*models.ImpactResult, error) {
	upstream, err := e.Loader.GetSubscription(upstreamRepoID)
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

	phases := []map[string]any{
		{"phase": 1, "name": "Development", "days": "Day 1-2", "risk": "low"},
		{"phase": 2, "name": "Staging", "days": "Day 3-4", "risk": "medium"},
		{"phase": 3, "name": "Production", "days": "Day 5-7", "risk": "critical", "gates": []string{"CAB approval"}},
	}

	if err := e.Store.UpsertChangePlan(ctx, changePlanID, upstream.GithubFullName, fromVersion, toVersion, phases); err != nil {
		return nil, err
	}

	allSubs, _ := e.Loader.LoadSubscriptions()
	subMap := map[string]models.RepoSubscription{}
	for _, s := range allSubs {
		subMap[s.ID] = s
	}

	for _, consumerID := range consumers {
		sub, ok := subMap[consumerID]
		if !ok || !sub.Subscribed || sub.Role != "downstream_consumer" {
			continue
		}
		pinned, signals := e.getConsumerModuleInfo(ctx, consumerID, upstreamRepoID)
		strategy, reason := selectStrategy(signals, sub.ComplianceScope)
		plan := models.RolloutPlan{
			ID:             uuid.New().String(),
			DownstreamRepo: sub.GithubFullName,
			PinnedVersion:  pinned,
			TargetVersion:  toVersion,
			VersionGap:     fmt.Sprintf("%s -> %s", pinned, toVersion),
			Strategy:       strategy,
			StrategyReason: reason,
			Rollback:       fmt.Sprintf("Revert module ref to %s across all stacks", fromVersion),
			Phases: []map[string]any{
				{"step": 1, "action": fmt.Sprintf("Bump module ref to %s in terragrunt.hcl", toVersion), "duration": "30 min"},
				{"step": 2, "action": "terragrunt run-all plan — validate outputs", "duration": "1 hr"},
				{"step": 3, "action": fmt.Sprintf("Apply using %s strategy", strategy), "duration": "2-48 hr"},
			},
		}
		if pinned != "" && pinned != toVersion {
			plan.BreakingChanges = []map[string]any{
				{"type": "version_gap", "detail": plan.VersionGap},
			}
		}
		if err := e.Store.InsertRolloutPlan(ctx, changePlanID, &plan); err != nil {
			return nil, err
		}
		result.RolloutPlans = append(result.RolloutPlans, plan)
		result.AffectedRepos = append(result.AffectedRepos, consumerID)
	}

	return result, nil
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
		// Fallback: all downstream_consumer subscriptions
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
