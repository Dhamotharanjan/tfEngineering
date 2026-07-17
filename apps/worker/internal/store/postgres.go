package store

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/acme/infragraph/worker/internal/models"
)

type Postgres struct {
	Pool *pgxpool.Pool
}

func Connect(ctx context.Context, dsn string) (*Postgres, error) {
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return nil, err
	}
	return &Postgres{Pool: pool}, nil
}

func (p *Postgres) InitSchema(ctx context.Context, schemaPath string) error {
	data, err := os.ReadFile(schemaPath)
	if err != nil {
		return err
	}
	_, err = p.Pool.Exec(ctx, string(data))
	return err
}

func (p *Postgres) SyncSubscriptions(ctx context.Context, repos []models.RepoSubscription) error {
	for _, r := range repos {
		triggers, _ := json.Marshal(r.TriggersEnabled)
		watched, _ := json.Marshal(r.ModuleSourcesWatched)
		compliance, _ := json.Marshal(r.ComplianceScope)
		contacts, _ := json.Marshal(r.Contacts)
		_, err := p.Pool.Exec(ctx, `
			INSERT INTO subscriptions (id, github_full_name, role, subscribed, entitlement_tier, scan_profile, local_path,
				appsvn, application_label, triggers_enabled, module_sources_watched, compliance_scope, contacts, updated_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now())
			ON CONFLICT (id) DO UPDATE SET
				github_full_name=EXCLUDED.github_full_name, role=EXCLUDED.role, subscribed=EXCLUDED.subscribed,
				entitlement_tier=EXCLUDED.entitlement_tier, scan_profile=EXCLUDED.scan_profile, local_path=EXCLUDED.local_path,
				appsvn=EXCLUDED.appsvn, application_label=EXCLUDED.application_label,
				triggers_enabled=EXCLUDED.triggers_enabled, module_sources_watched=EXCLUDED.module_sources_watched,
				compliance_scope=EXCLUDED.compliance_scope, contacts=EXCLUDED.contacts, updated_at=now()
		`, r.ID, r.GithubFullName, r.Role, r.Subscribed, r.EntitlementTier, r.ScanProfile, r.LocalPath,
			nullIfEmpty(r.Appsvn), nullIfEmpty(r.ApplicationLabel), triggers, watched, compliance, contacts)
		if err != nil {
			return err
		}
	}
	return nil
}

func (p *Postgres) CreateScanJob(ctx context.Context, jobType, priority, repoID string, payload map[string]any) (string, error) {
	id := uuid.New().String()
	pb, _ := json.Marshal(payload)
	_, err := p.Pool.Exec(ctx, `
		INSERT INTO scan_jobs (id, job_type, priority, repo_id, payload, status) VALUES ($1,$2,$3,$4,$5,'pending')
	`, id, jobType, priority, repoID, pb)
	return id, err
}

func (p *Postgres) CompleteScanJob(ctx context.Context, jobID, status string, errMsg string) error {
	_, err := p.Pool.Exec(ctx, `
		UPDATE scan_jobs SET status=$2, error_message=$3, completed_at=now() WHERE id=$1
	`, jobID, status, errMsg)
	return err
}

func (p *Postgres) RecordScanRun(ctx context.Context, jobID, repoID, stage, status string, nodes, edges int, artifact string) error {
	_, err := p.Pool.Exec(ctx, `
		INSERT INTO scan_runs (job_id, repo_id, stage, status, nodes_written, edges_written, artifact_path)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
	`, jobID, repoID, stage, status, nodes, edges, artifact)
	return err
}

func (p *Postgres) UpdateSubscriptionScan(ctx context.Context, repoID, status string, nodeCount int) error {
	_, err := p.Pool.Exec(ctx, `
		UPDATE subscriptions SET last_scan_at=now(), last_scan_status=$2, graph_node_count=$3, updated_at=now() WHERE id=$1
	`, repoID, status, nodeCount)
	return err
}

func (p *Postgres) UpsertChangePlan(ctx context.Context, id, module, from, to string, phases []map[string]any) error {
	pb, _ := json.Marshal(phases)
	_, err := p.Pool.Exec(ctx, `
		INSERT INTO change_plans (id, upstream_module, from_version, to_version, status, phases, rollback, updated_at)
		VALUES ($1,$2,$3,$4,'pending_approval',$5,$6,now())
		ON CONFLICT (id) DO UPDATE SET phases=EXCLUDED.phases, to_version=EXCLUDED.to_version, updated_at=now()
	`, id, module, from, to, pb, fmt.Sprintf("Revert to %s", from))
	return err
}

func (p *Postgres) InsertRolloutPlan(ctx context.Context, changePlanID string, plan *models.RolloutPlan) error {
	phases, _ := json.Marshal(plan.Phases)
	breaking, _ := json.Marshal(plan.BreakingChanges)
	drift, _ := json.Marshal(plan.MockOutputsDrift)
	_, err := p.Pool.Exec(ctx, `
		INSERT INTO rollout_plans (id, change_plan_id, downstream_repo, pinned_version, target_version, strategy, strategy_reason, version_gap, phases, breaking_changes, mock_outputs_drift, rollback, status)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pending')
		ON CONFLICT (id) DO NOTHING
	`, plan.ID, changePlanID, plan.DownstreamRepo, plan.PinnedVersion, plan.TargetVersion,
		plan.Strategy, plan.StrategyReason, plan.VersionGap, phases, breaking, drift, plan.Rollback)
	return err
}

func (p *Postgres) InsertEOLRisk(ctx context.Context, repoID string, signal map[string]any) error {
	_, err := p.Pool.Exec(ctx, `
		INSERT INTO eol_risks (repo_id, resource_ref, resource_type, current_version, risk, action)
		VALUES ($1,$2,$3,$4,$5,$6)
	`, repoID, signal["file"], signal["type"], signal["version"], "extended_support_risk", "upgrade_plan_available")
	return err
}

func (p *Postgres) Audit(ctx context.Context, actor, action, target string) error {
	_, err := p.Pool.Exec(ctx, `
		INSERT INTO audit_log (actor, action, target, event_time) VALUES ($1,$2,$3,$4)
	`, actor, action, target, time.Now().UTC())
	return err
}

func (p *Postgres) ListSubscriptions(ctx context.Context) ([]map[string]any, error) {
	rows, err := p.Pool.Query(ctx, `
		SELECT id, github_full_name, role, subscribed, entitlement_tier, scan_profile, local_path,
		       last_scan_at, last_scan_status, graph_node_count, triggers_enabled, module_sources_watched
		FROM subscriptions ORDER BY id
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, gh, role, tier, profile, localPath, scanStatus string
		var subscribed bool
		var lastScan *time.Time
		var nodeCount int
		var triggers, watched []byte
		if err := rows.Scan(&id, &gh, &role, &subscribed, &tier, &profile, &localPath, &lastScan, &scanStatus, &nodeCount, &triggers, &watched); err != nil {
			return nil, err
		}
		item := map[string]any{
			"id": id, "github_full_name": gh, "role": role, "subscribed": subscribed,
			"entitlement_tier": tier, "scan_profile": profile, "local_path": localPath,
			"last_scan_status": scanStatus, "graph_node_count": nodeCount,
		}
		if lastScan != nil {
			item["last_scan_at"] = lastScan.Format(time.RFC3339)
		}
		var t map[string]any
		_ = json.Unmarshal(triggers, &t)
		item["triggers_enabled"] = t
		out = append(out, item)
	}
	return out, rows.Err()
}

func (p *Postgres) GetBlastRadiusSummary(ctx context.Context, moduleID string) (map[string]any, error) {
	rows, err := p.Pool.Query(ctx, `
		SELECT downstream_repo, strategy, pinned_version, target_version, version_gap
		FROM rollout_plans ORDER BY created_at DESC LIMIT 20
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var plans []map[string]any
	for rows.Next() {
		var repo, strategy, pinned, target, gap string
		if err := rows.Scan(&repo, &strategy, &pinned, &target, &gap); err != nil {
			return nil, err
		}
		plans = append(plans, map[string]any{
			"downstream_repo": repo, "strategy": strategy,
			"pinned_version": pinned, "target_version": target, "version_gap": gap,
		})
	}
	return map[string]any{
		"module_id": moduleID,
		"downstream_plans": plans,
		"stacks": len(plans),
	}, rows.Err()
}

func (p *Postgres) GetChangePlan(ctx context.Context, id string) (map[string]any, error) {
	var module, from, to, status, rollback string
	var phases []byte
	err := p.Pool.QueryRow(ctx, `
		SELECT upstream_module, from_version, to_version, status, phases, rollback FROM change_plans WHERE id=$1
	`, id).Scan(&module, &from, &to, &status, &phases, &rollback)
	if err != nil {
		return nil, err
	}
	var ph []map[string]any
	_ = json.Unmarshal(phases, &ph)
	return map[string]any{
		"id": id, "upstream_module": module, "from_version": from, "to_version": to,
		"status": status, "phases": ph, "rollback": rollback,
	}, nil
}

func (p *Postgres) GetRolloutPlans(ctx context.Context, changePlanID string) ([]map[string]any, error) {
	rows, err := p.Pool.Query(ctx, `
		SELECT id, downstream_repo, strategy, strategy_reason, pinned_version, target_version, version_gap, phases, rollback
		FROM rollout_plans WHERE change_plan_id=$1 OR $1='' ORDER BY created_at DESC
	`, changePlanID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, repo, strategy, reason, pinned, target, gap, rollback string
		var phases []byte
		if err := rows.Scan(&id, &repo, &strategy, &reason, &pinned, &target, &gap, &phases, &rollback); err != nil {
			return nil, err
		}
		var ph []map[string]any
		_ = json.Unmarshal(phases, &ph)
		out = append(out, map[string]any{
			"id": id, "downstream_repo": repo, "strategy": strategy, "strategy_reason": reason,
			"pinned_version": pinned, "target_version": target, "version_gap": gap,
			"phases": ph, "rollback": rollback,
		})
	}
	return out, rows.Err()
}

func (p *Postgres) ListScanJobs(ctx context.Context, limit int) ([]map[string]any, error) {
	rows, err := p.Pool.Query(ctx, `
		SELECT id, job_type, priority, repo_id, status, created_at, completed_at FROM scan_jobs ORDER BY created_at DESC LIMIT $1
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, jtype, priority, repoID, status string
		var created, completed *time.Time
		if err := rows.Scan(&id, &jtype, &priority, &repoID, &status, &created, &completed); err != nil {
			return nil, err
		}
		item := map[string]any{"id": id, "job_type": jtype, "priority": priority, "repo_id": repoID, "status": status}
		if created != nil {
			item["created_at"] = created.Format(time.RFC3339)
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func (p *Postgres) ListEOLRisks(ctx context.Context) ([]map[string]any, error) {
	rows, err := p.Pool.Query(ctx, `SELECT repo_id, resource_ref, resource_type, current_version, risk, monthly_cost_usd, action FROM eol_risks ORDER BY detected_at DESC LIMIT 50`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var repo, ref, rtype, ver, risk, action string
		var cost *float64
		if err := rows.Scan(&repo, &ref, &rtype, &ver, &risk, &cost, &action); err != nil {
			return nil, err
		}
		item := map[string]any{"repo": repo, "resource": ref, "type": rtype, "version": ver, "risk": risk, "action": action}
		if cost != nil {
			item["monthlyCost"] = *cost
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func (p *Postgres) ListAuditLog(ctx context.Context, limit int) ([]map[string]any, error) {
	rows, err := p.Pool.Query(ctx, `SELECT event_time, actor, action, target, source_ip FROM audit_log ORDER BY event_time DESC LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var actor, action, target string
		var sourceIP *string
		var t time.Time
		if err := rows.Scan(&t, &actor, &action, &target, &sourceIP); err != nil {
			return nil, err
		}
		item := map[string]any{"time": t.Format("2006-01-02 15:04:05"), "user": actor, "action": action, "target": target, "ip": "system"}
		if sourceIP != nil {
			item["ip"] = *sourceIP
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func (p *Postgres) SaveEmbeddingChunk(ctx context.Context, repoID, chunkType, content string, metadata map[string]any) (string, error) {
	id := uuid.New().String()
	mb, _ := json.Marshal(metadata)
	_, err := p.Pool.Exec(ctx, `
		INSERT INTO embedding_chunks (id, repo_id, chunk_type, content, metadata) VALUES ($1,$2,$3,$4,$5)
	`, id, repoID, chunkType, content, mb)
	return id, err
}

func (p *Postgres) BeginScanRun(ctx context.Context, jobID, repoID, stage string) (string, error) {
	id := uuid.New().String()
	var jobRef any
	if _, err := uuid.Parse(jobID); err == nil {
		jobRef = jobID
	}
	_, err := p.Pool.Exec(ctx, `
		INSERT INTO scan_runs (id, job_id, repo_id, stage, status) VALUES ($1,$2,$3,$4,'in_progress')
	`, id, jobRef, repoID, stage)
	return id, err
}

func (p *Postgres) PersistParseResult(ctx context.Context, scanRunID string, repoID string, parsed *models.ParseResult, subs []models.RepoSubscription) error {
	tx, err := p.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	repoScopedTables := []string{
		"resource_dependencies", "stack_dependencies", "module_references",
		"config_values", "resources", "parsed_blocks", "data_sources",
		"variables", "outputs", "provider_configs", "remote_state_refs",
	}
	for _, table := range repoScopedTables {
		if _, err := tx.Exec(ctx, fmt.Sprintf("DELETE FROM %s WHERE repo_id = $1", table), repoID); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(ctx, `DELETE FROM upstream_lineage WHERE consumer_repo_id = $1`, repoID); err != nil {
		return err
	}

	repoAppsvn := ""
	for _, s := range subs {
		if s.ID == repoID {
			repoAppsvn = s.Appsvn
			break
		}
	}

	for _, res := range parsed.Resources {
		addr := fmt.Sprintf("%s.%s", res.Type, res.Name)
		resID := fmt.Sprintf("%s:%s", repoID, addr)
		// Persist nested blocks (ingress/egress, etc.) under _nested_blocks for auditor architecture.
		attrMap := map[string]any{}
		for k, v := range res.Attributes {
			attrMap[k] = v
		}
		if len(res.NestedBlocks) > 0 {
			attrMap["_nested_blocks"] = res.NestedBlocks
		}
		attrs, _ := json.Marshal(attrMap)
		appsvn := resolveResourceAppsvn(res.Tags, repoAppsvn)
		if _, err := tx.Exec(ctx, `
			INSERT INTO resources (id, repo_id, scan_run_id, address, type, name, file, line, service_id, appsvn, attributes)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
		`, resID, repoID, scanRunID, addr, res.Type, res.Name, res.File, res.Line, res.ServiceID, nullIfEmpty(appsvn), attrs); err != nil {
			return err
		}
		for _, dep := range res.DependsOn {
			if _, err := tx.Exec(ctx, `
				INSERT INTO resource_dependencies (repo_id, from_address, to_address, kind)
				VALUES ($1,$2,$3,'depends_on')
			`, repoID, addr, dep); err != nil {
				return err
			}
		}
		for k, v := range res.Attributes {
			vb, _ := json.Marshal(v)
			if _, err := tx.Exec(ctx, `
				INSERT INTO config_values (repo_id, scan_run_id, scope, path, key, value_json, sensitive)
				VALUES ($1,$2,'resource',$3,$4,$5,$6)
			`, repoID, scanRunID, addr, k, vb, isSensitiveKey(k)); err != nil {
				return err
			}
		}
		for _, ref := range res.References {
			if _, err := tx.Exec(ctx, `
				INSERT INTO resource_dependencies (repo_id, from_address, to_address, kind)
				VALUES ($1,$2,$3,'reference')
			`, repoID, addr, ref); err != nil {
				return err
			}
		}
	}

	for _, ds := range parsed.DataSources {
		addr := fmt.Sprintf("data.%s.%s", ds.Type, ds.Name)
		dsID := fmt.Sprintf("%s:%s", repoID, addr)
		attrs, _ := json.Marshal(ds.Attributes)
		nested, _ := json.Marshal(ds.NestedBlocks)
		refs, _ := json.Marshal(ds.References)
		if _, err := tx.Exec(ctx, `
			INSERT INTO data_sources (id, repo_id, scan_run_id, address, type, name, file, line, attributes, nested_blocks, references_json)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
		`, dsID, repoID, scanRunID, addr, ds.Type, ds.Name, ds.File, ds.Line, attrs, nested, refs); err != nil {
			return err
		}
	}

	for _, v := range parsed.Variables {
		vID := fmt.Sprintf("%s:var.%s", repoID, v.Name)
		def, _ := json.Marshal(v.DefaultJSON)
		if _, err := tx.Exec(ctx, `
			INSERT INTO variables (id, repo_id, scan_run_id, name, var_type, default_json, sensitive, description, file, line)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
		`, vID, repoID, scanRunID, v.Name, v.VarType, def, v.Sensitive, v.Description, v.File, v.Line); err != nil {
			return err
		}
	}

	for _, o := range parsed.Outputs {
		oID := fmt.Sprintf("%s:output.%s", repoID, o.Name)
		if _, err := tx.Exec(ctx, `
			INSERT INTO outputs (id, repo_id, scan_run_id, name, sensitive, file, line, value_ref)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
		`, oID, repoID, scanRunID, o.Name, o.Sensitive, o.File, o.Line, o.ValueRef); err != nil {
			return err
		}
	}

	for _, p := range parsed.Providers {
		pID := fmt.Sprintf("%s:provider.%s", repoID, p.ProviderType)
		if p.Alias != "" {
			pID = fmt.Sprintf("%s:provider.%s.%s", repoID, p.ProviderType, p.Alias)
		}
		attrs, _ := json.Marshal(p.Attributes)
		if _, err := tx.Exec(ctx, `
			INSERT INTO provider_configs (id, repo_id, scan_run_id, provider_type, alias, attributes, file, line)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
		`, pID, repoID, scanRunID, p.ProviderType, p.Alias, attrs, p.File, p.Line); err != nil {
			return err
		}
	}

	for _, pb := range parsed.ParsedBlocks {
		labels, _ := json.Marshal(pb.Labels)
		attrs, _ := json.Marshal(pb.Attributes)
		nested, _ := json.Marshal(pb.NestedBlocks)
		if _, err := tx.Exec(ctx, `
			INSERT INTO parsed_blocks (repo_id, scan_run_id, block_type, labels, file, line, attributes, nested_blocks)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
		`, repoID, scanRunID, pb.BlockType, labels, pb.File, pb.Line, attrs, nested); err != nil {
			return err
		}
	}

	for _, rs := range parsed.RemoteStates {
		cfg, _ := json.Marshal(rs.Config)
		if _, err := tx.Exec(ctx, `
			INSERT INTO remote_state_refs (repo_id, scan_run_id, name, backend, state_key, target_repo_hint, config, file, line)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		`, repoID, scanRunID, rs.Name, rs.Backend, rs.StateKey, rs.TargetRepoHint, cfg, rs.File, rs.Line); err != nil {
			return err
		}
	}

	for _, m := range parsed.Modules {
		if _, err := tx.Exec(ctx, `
			INSERT INTO module_references (repo_id, module_source, ref, version, file, line)
			VALUES ($1,$2,$3,$4,$5,$6)
		`, repoID, m.Source, m.Ref, m.Version, m.File, m.Line); err != nil {
			return err
		}
	}

	for _, s := range parsed.Stacks {
		if s.Source != "" {
			if _, err := tx.Exec(ctx, `
				INSERT INTO module_references (repo_id, stack_file, module_source, ref, file)
				VALUES ($1,$2,$3,$4,$5)
			`, repoID, s.File, s.Source, extractRefFromSource(s.Source), s.File); err != nil {
				return err
			}
		}
		for _, dep := range s.Dependencies {
			if _, err := tx.Exec(ctx, `
				INSERT INTO stack_dependencies (repo_id, stack_file, depends_on_path)
				VALUES ($1,$2,$3)
			`, repoID, s.File, dep); err != nil {
				return err
			}
		}
		for k, v := range s.Inputs {
			vb, _ := json.Marshal(v)
			if _, err := tx.Exec(ctx, `
				INSERT INTO config_values (repo_id, scan_run_id, scope, path, key, value_json, sensitive)
				VALUES ($1,$2,'stack',$3,$4,$5,$6)
			`, repoID, scanRunID, s.File, k, vb, isSensitiveKey(k)); err != nil {
				return err
			}
		}
	}

	lineage := computeUpstreamLineage(repoID, parsed, subs)
	for _, row := range lineage {
		if _, err := tx.Exec(ctx, `
			INSERT INTO upstream_lineage (consumer_repo_id, module_id, upstream_repo_id, depth)
			VALUES ($1,$2,$3,$4)
		`, row.ConsumerRepoID, row.ModuleID, row.UpstreamRepoID, row.Depth); err != nil {
			return err
		}
	}

	_, err = tx.Exec(ctx, `UPDATE scan_runs SET status='completed' WHERE id=$1`, scanRunID)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

type lineageRow struct {
	ConsumerRepoID  string
	ModuleID        string
	UpstreamRepoID  string
	Depth           int
}

func computeUpstreamLineage(consumerRepoID string, parsed *models.ParseResult, subs []models.RepoSubscription) []lineageRow {
	seen := map[string]bool{}
	var out []lineageRow
	add := func(moduleID, upstreamID string) {
		key := moduleID + "|" + upstreamID
		if seen[key] {
			return
		}
		seen[key] = true
		out = append(out, lineageRow{
			ConsumerRepoID: consumerRepoID,
			ModuleID:       moduleID,
			UpstreamRepoID: upstreamID,
			Depth:          1,
		})
	}

	sources := []string{}
	for _, m := range parsed.Modules {
		if m.Source != "" {
			sources = append(sources, m.Source)
		}
	}
	for _, s := range parsed.Stacks {
		if s.Source != "" {
			sources = append(sources, s.Source)
		}
	}

	for _, source := range sources {
		modID := moduleIDFromSource(source, extractRefFromSource(source))
		if upstream := resolveUpstreamRepo(source, subs); upstream != "" {
			add(modID, upstream)
		}
	}
	return out
}

func resolveUpstreamRepo(source string, subs []models.RepoSubscription) string {
	basename := filepathBasename(source)
	for _, s := range subs {
		if s.ID == basename || strings.HasSuffix(s.LocalPath, basename) {
			return s.ID
		}
		if s.GithubFullName != "" && strings.Contains(source, s.GithubFullName) {
			return s.ID
		}
		ghParts := strings.Split(s.GithubFullName, "/")
		if len(ghParts) == 2 && strings.Contains(source, ghParts[1]) {
			return s.ID
		}
	}
	return ""
}

func filepathBasename(source string) string {
	source = strings.TrimSuffix(source, "/")
	if i := strings.Index(source, "?"); i >= 0 {
		source = source[:i]
	}
	if i := strings.LastIndex(source, "//"); i >= 0 {
		source = source[i+2:]
	}
	source = strings.TrimPrefix(source, "../")
	source = strings.TrimPrefix(source, "./")
	if i := strings.LastIndex(source, "/"); i >= 0 {
		return source[i+1:]
	}
	return source
}

func moduleIDFromSource(source, ref string) string {
	if ref != "" {
		return source + "@" + ref
	}
	return source
}

func extractRefFromSource(source string) string {
	if i := strings.Index(source, "?ref="); i >= 0 {
		return strings.Trim(source[i+5:], `"`)
	}
	if i := strings.Index(source, "ref="); i >= 0 {
		return strings.Trim(source[i+4:], `"`)
	}
	return ""
}

func isSensitiveKey(key string) bool {
	return configDefaultRedact(key)
}

func configDefaultRedact(key string) bool {
	lower := strings.ToLower(key)
	return strings.Contains(lower, "password") || strings.Contains(lower, "secret") ||
		strings.Contains(lower, "token") || strings.Contains(lower, "private_key")
}

func (p *Postgres) ListParsedBlocks(ctx context.Context, repoID, blockType string) ([]map[string]any, error) {
	q := `SELECT id, block_type, labels, file, line, attributes, nested_blocks, created_at FROM parsed_blocks WHERE repo_id=$1`
	args := []any{repoID}
	if blockType != "" {
		q += ` AND block_type=$2`
		args = append(args, blockType)
	}
	q += ` ORDER BY file, line`
	rows, err := p.Pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, btype, file string
		var line int
		var labels, attrs, nested []byte
		var created time.Time
		if err := rows.Scan(&id, &btype, &labels, &file, &line, &attrs, &nested, &created); err != nil {
			return nil, err
		}
		var labelArr []string
		var attrMap, nestedMap map[string]any
		_ = json.Unmarshal(labels, &labelArr)
		_ = json.Unmarshal(attrs, &attrMap)
		_ = json.Unmarshal(nested, &nestedMap)
		out = append(out, map[string]any{
			"id": id, "block_type": btype, "labels": labelArr, "file": file, "line": line,
			"attributes": attrMap, "nested_blocks": nestedMap, "created_at": created.Format(time.RFC3339),
		})
	}
	return out, rows.Err()
}

func (p *Postgres) ListVariables(ctx context.Context, repoID string) ([]map[string]any, error) {
	rows, err := p.Pool.Query(ctx, `
		SELECT name, var_type, default_json, sensitive, description, file, line, created_at
		FROM variables WHERE repo_id=$1 ORDER BY name
	`, repoID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var name, varType, desc, file string
		var sensitive bool
		var line int
		var def []byte
		var created time.Time
		if err := rows.Scan(&name, &varType, &def, &sensitive, &desc, &file, &line, &created); err != nil {
			return nil, err
		}
		var defVal any
		_ = json.Unmarshal(def, &defVal)
		out = append(out, map[string]any{
			"name": name, "var_type": varType, "default": defVal, "sensitive": sensitive,
			"description": desc, "file": file, "line": line, "created_at": created.Format(time.RFC3339),
		})
	}
	return out, rows.Err()
}

func (p *Postgres) ListResources(ctx context.Context, repoID string) ([]map[string]any, error) {
	rows, err := p.Pool.Query(ctx, `
		SELECT id, address, type, name, file, line, service_id, attributes, created_at
		FROM resources WHERE repo_id=$1 ORDER BY address
	`, repoID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, address, rtype, name, file, serviceID string
		var line int
		var attrs []byte
		var created time.Time
		if err := rows.Scan(&id, &address, &rtype, &name, &file, &line, &serviceID, &attrs, &created); err != nil {
			return nil, err
		}
		var attrMap map[string]any
		_ = json.Unmarshal(attrs, &attrMap)
		out = append(out, map[string]any{
			"id": id, "address": address, "type": rtype, "name": name,
			"file": file, "line": line, "service_id": serviceID,
			"attributes": attrMap, "created_at": created.Format(time.RFC3339),
		})
	}
	return out, rows.Err()
}

func (p *Postgres) ListUpstreamLayers(ctx context.Context, repoID string) ([]map[string]any, error) {
	rows, err := p.Pool.Query(ctx, `
		SELECT ul.module_id, ul.upstream_repo_id, ul.depth, s.github_full_name, s.role
		FROM upstream_lineage ul
		LEFT JOIN subscriptions s ON s.id = ul.upstream_repo_id
		WHERE ul.consumer_repo_id=$1
		ORDER BY ul.depth, ul.module_id
	`, repoID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var moduleID, upstreamID, gh, role string
		var depth int
		if err := rows.Scan(&moduleID, &upstreamID, &depth, &gh, &role); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"module_id": moduleID, "upstream_repo_id": upstreamID,
			"depth": depth, "github_full_name": gh, "role": role,
		})
	}
	return out, rows.Err()
}

func (p *Postgres) ListRepoDependencies(ctx context.Context, repoID string) (map[string]any, error) {
	resDeps, err := p.Pool.Query(ctx, `
		SELECT from_address, to_address, kind FROM resource_dependencies WHERE repo_id=$1 ORDER BY from_address
	`, repoID)
	if err != nil {
		return nil, err
	}
	defer resDeps.Close()
	var resourceDeps []map[string]any
	for resDeps.Next() {
		var from, to, kind string
		if err := resDeps.Scan(&from, &to, &kind); err != nil {
			return nil, err
		}
		resourceDeps = append(resourceDeps, map[string]any{"from": from, "to": to, "kind": kind})
	}

	stackDeps, err := p.Pool.Query(ctx, `
		SELECT stack_file, depends_on_path FROM stack_dependencies WHERE repo_id=$1 ORDER BY stack_file
	`, repoID)
	if err != nil {
		return nil, err
	}
	defer stackDeps.Close()
	var stackDepList []map[string]any
	for stackDeps.Next() {
		var stackFile, depPath string
		if err := stackDeps.Scan(&stackFile, &depPath); err != nil {
			return nil, err
		}
		stackDepList = append(stackDepList, map[string]any{"stack_file": stackFile, "depends_on_path": depPath})
	}

	modRefs, err := p.Pool.Query(ctx, `
		SELECT stack_file, module_source, ref, version, file, line FROM module_references WHERE repo_id=$1 ORDER BY module_source
	`, repoID)
	if err != nil {
		return nil, err
	}
	defer modRefs.Close()
	var modules []map[string]any
	for modRefs.Next() {
		var stackFile, source, ref, version, file *string
		var line *int
		if err := modRefs.Scan(&stackFile, &source, &ref, &version, &file, &line); err != nil {
			return nil, err
		}
		modules = append(modules, map[string]any{
			"stack_file": stackFile, "module_source": source, "ref": ref,
			"version": version, "file": file, "line": line,
		})
	}

	return map[string]any{
		"repo_id":               repoID,
		"resource_dependencies": resourceDeps,
		"stack_dependencies":    stackDepList,
		"module_references":     modules,
	}, nil
}

func (p *Postgres) ListPatternAlerts(ctx context.Context) ([]map[string]any, error) {
	rows, err := p.Pool.Query(ctx, `SELECT pattern_type, severity, title, description, affected_repos FROM pattern_alerts ORDER BY created_at DESC LIMIT 20`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var ptype, sev, title, desc string
		var repos []byte
		if err := rows.Scan(&ptype, &sev, &title, &desc, &repos); err != nil {
			return nil, err
		}
		var affected []string
		_ = json.Unmarshal(repos, &affected)
		out = append(out, map[string]any{
			"pattern_type": ptype, "severity": sev, "title": title, "description": desc, "affected_repos": affected,
		})
	}
	return out, rows.Err()
}

func nullIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// resolveResourceAppsvn prefers Terraform tags.APPSVN / tags.Appsvn, else repo-level appsvn.
func resolveResourceAppsvn(tags map[string]string, repoAppsvn string) string {
	if tags != nil {
		for _, key := range []string{"APPSVN", "Appsvn", "appsvn", "AppSVN"} {
			if v := strings.TrimSpace(tags[key]); v != "" {
				return v
			}
		}
	}
	return repoAppsvn
}
