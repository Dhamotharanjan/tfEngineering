package config

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// ScanProfile is the typed view of config/scan-profiles.json.
type ScanProfile struct {
	ProfileID              string                       `json:"profile_id"`
	Triggers               ScanTriggers                 `json:"triggers"`
	TerraformScanFields    TerraformScanFields          `json:"terraform_scan_fields"`
	TerragruntScanFields   TerragruntScanFields         `json:"terragrunt_scan_fields"`
	MetadataScanFields     map[string]any               `json:"metadata_scan_fields"`
	RolloutStrategySignals map[string]RolloutSignalRule `json:"rollout_strategy_signals"`
	EOLTrackingFields      map[string]EOLTrackingRule   `json:"eol_tracking_fields"`
	SecurityScanFields     map[string]SecurityScanRule  `json:"security_scan_fields"`
	Redaction              RedactionRules               `json:"redaction"`
}

type ScanTriggers struct {
	ReleaseTag        TriggerReleaseTag `json:"release_tag"`
	PullRequest       TriggerPR         `json:"pull_request"`
	PushDefaultBranch TriggerPush       `json:"push_default_branch"`
	Schedule          TriggerSchedule   `json:"schedule"`
}

type TriggerReleaseTag struct {
	Enabled                 bool     `json:"enabled"`
	TagPatterns             []string `json:"tag_patterns"`
	MandatoryImpactAnalysis bool     `json:"mandatory_impact_analysis"`
}

type TriggerPR struct {
	Enabled     bool     `json:"enabled"`
	PathsFilter []string `json:"paths_filter"`
}

type TriggerPush struct {
	Enabled         bool `json:"enabled"`
	IncrementalOnly bool `json:"incremental_only"`
}

type TriggerSchedule struct {
	FullReconcileCron string `json:"full_reconcile_cron"`
	EOLCheckCron      string `json:"eol_check_cron"`
	FinOpsSyncCron    string `json:"finops_sync_cron"`
}

// PathFiltersForPush returns glob-like path suffixes to include on incremental scans.
func (p *ScanProfile) PathFiltersForPush() []string {
	if p == nil {
		return []string{"**/*.tf", "**/*.hcl"}
	}
	if len(p.Triggers.PullRequest.PathsFilter) > 0 {
		return p.Triggers.PullRequest.PathsFilter
	}
	return []string{"**/*.tf", "**/*.hcl"}
}

func (p *ScanProfile) IncrementalOnlyOnPush() bool {
	if p == nil {
		return true
	}
	return p.Triggers.PushDefaultBranch.IncrementalOnly
}

func (p *ScanProfile) FullReconcileCron() string {
	if p == nil || p.Triggers.Schedule.FullReconcileCron == "" {
		return "0 2 * * *"
	}
	return p.Triggers.Schedule.FullReconcileCron
}

type TerraformScanFields struct {
	ModuleBlocks         BlockFieldConfig `json:"module_blocks"`
	ResourceBlocks       BlockFieldConfig `json:"resource_blocks"`
	DataBlocks           BlockFieldConfig `json:"data_blocks"`
	VariableBlocks       BlockFieldConfig `json:"variable_blocks"`
	OutputBlocks         BlockFieldConfig `json:"output_blocks"`
	ProviderBlocks       BlockFieldConfig `json:"provider_blocks"`
	BackendBlocks        BlockFieldConfig `json:"backend_blocks"`
	TerraformRemoteState BlockFieldConfig `json:"terraform_remote_state"`
}

type TerragruntScanFields struct {
	Include      BlockFieldConfig `json:"include"`
	Dependency   BlockFieldConfig `json:"dependency"`
	Dependencies BlockFieldConfig `json:"dependencies"`
	Inputs       BlockFieldConfig `json:"inputs"`
	Locals       BlockFieldConfig `json:"locals"`
	Source       BlockFieldConfig `json:"source"`
	Generate     BlockFieldConfig `json:"generate"`
}

type BlockFieldConfig struct {
	Enabled             bool     `json:"enabled"`
	Extract             []string `json:"extract"`
	AttributeAllowlist  string   `json:"attribute_allowlist"`
	AttributeDenylist   []string `json:"attribute_denylist"`
	RedactKeys          []string `json:"redact_keys"`
}

type RolloutSignalRule struct {
	ResourcePatterns   []string `json:"resource_patterns"`
	VariablePatterns   []string `json:"variable_patterns"`
	AttributePatterns  []string `json:"attribute_patterns"`
}

type EOLTrackingRule struct {
	Resource   string   `json:"resource"`
	Attributes []string `json:"attributes"`
}

type SecurityScanRule struct {
	Enabled   bool     `json:"enabled"`
	Resource  string   `json:"resource"`
	Attribute string   `json:"attribute"`
	Expected  any      `json:"expected"`
	CidrDeny  []string `json:"cidr_deny"`
}

type RedactionRules struct {
	NeverStorePatterns   []string `json:"never_store_patterns"`
	HashInsteadOfStore   []string `json:"hash_instead_of_store"`
}

func (l *Loader) LoadScanProfileByID(profileID string) (*ScanProfile, error) {
	path := filepath.Join(l.Root, "config", "scan-profiles.json")
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var profile ScanProfile
	if err := json.Unmarshal(data, &profile); err != nil {
		return nil, err
	}
	if profileID != "" && profile.ProfileID != "" && profile.ProfileID != profileID {
		return nil, fmt.Errorf("scan profile %q not found (file has %q)", profileID, profile.ProfileID)
	}
	return &profile, nil
}

// ShouldRedact returns true if the key matches never_store_patterns from the profile.
func (p *ScanProfile) ShouldRedact(key string) bool {
	if p == nil {
		return defaultRedact(key)
	}
	lower := strings.ToLower(key)
	for _, pat := range p.Redaction.NeverStorePatterns {
		if globMatch(strings.ToLower(pat), lower) {
			return true
		}
	}
	for _, deny := range p.TerraformScanFields.ResourceBlocks.AttributeDenylist {
		if strings.EqualFold(key, deny) {
			return true
		}
	}
	for _, deny := range p.TerragruntScanFields.Inputs.RedactKeys {
		if strings.EqualFold(key, deny) {
			return true
		}
	}
	return false
}

func (p *ScanProfile) IsBlockEnabled(blockType string) bool {
	if p == nil {
		return true
	}
	switch blockType {
	case "module":
		return p.TerraformScanFields.ModuleBlocks.Enabled
	case "resource":
		return p.TerraformScanFields.ResourceBlocks.Enabled
	case "data":
		return p.TerraformScanFields.DataBlocks.Enabled
	case "variable":
		return p.TerraformScanFields.VariableBlocks.Enabled
	case "output":
		return p.TerraformScanFields.OutputBlocks.Enabled
	case "provider":
		return p.TerraformScanFields.ProviderBlocks.Enabled
	case "terraform":
		return true
	case "locals":
		return true
	case "dependency":
		return p.TerragruntScanFields.Dependency.Enabled
	case "dependencies":
		return p.TerragruntScanFields.Dependencies.Enabled
	case "include":
		return p.TerragruntScanFields.Include.Enabled
	case "generate":
		return p.TerragruntScanFields.Generate.Enabled
	case "inputs":
		return p.TerragruntScanFields.Inputs.Enabled
	default:
		return true
	}
}

func globMatch(pattern, value string) bool {
	pattern = strings.ReplaceAll(pattern, "*", "")
	return strings.Contains(value, pattern)
}

func defaultRedact(key string) bool {
	lower := strings.ToLower(key)
	return strings.Contains(lower, "password") || strings.Contains(lower, "secret") ||
		strings.Contains(lower, "token") || strings.Contains(lower, "private_key")
}
