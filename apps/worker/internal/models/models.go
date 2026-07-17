package models

type Job struct {
	ID       string         `json:"id"`
	Type     string         `json:"type"`
	Priority string         `json:"priority"`
	RepoID   string         `json:"repo_id"`
	Payload  map[string]any `json:"payload"`
}

type RepoSubscription struct {
	ID                   string            `json:"id"`
	GithubFullName       string            `json:"github_full_name"`
	Role                 string            `json:"role"`
	Subscribed           bool              `json:"subscribed"`
	EntitlementTier      string            `json:"entitlement_tier"`
	ScanProfile          string            `json:"scan_profile"`
	LocalPath            string            `json:"local_path"`
	// Layer 2 application tag — multiple repos may share one APPSVN.
	Appsvn               string            `json:"appsvn,omitempty"`
	ApplicationLabel     string            `json:"application_label,omitempty"`
	TriggersEnabled      map[string]bool   `json:"triggers_enabled"`
	ModuleSourcesWatched []string          `json:"module_sources_watched"`
	AwsAccountsLinked    []string          `json:"aws_accounts_linked"`
	ComplianceScope      []string          `json:"compliance_scope"`
	Contacts             map[string]string `json:"contacts"`
	EOLTracking          map[string]any    `json:"eol_tracking"`
}

type ModuleRef struct {
	Name      string         `json:"name"`
	Source    string         `json:"source"`
	Version   string         `json:"version"`
	Ref       string         `json:"ref"`
	File      string         `json:"file"`
	Line      int            `json:"line"`
	Providers map[string]any `json:"providers,omitempty"`
	Count     string         `json:"count,omitempty"`
	ForEach   string         `json:"for_each,omitempty"`
}

type ResourceRef struct {
	Type         string            `json:"type"`
	Name         string            `json:"name"`
	ServiceID    string            `json:"service_id"`
	Attributes   map[string]any    `json:"attributes"`
	NestedBlocks map[string]any    `json:"nested_blocks,omitempty"`
	References   []string          `json:"references,omitempty"`
	DependsOn    []string          `json:"depends_on"`
	File         string            `json:"file"`
	Line         int               `json:"line"`
	Tags         map[string]string `json:"tags"`
}

type DataSourceRef struct {
	Type         string         `json:"type"`
	Name         string         `json:"name"`
	File         string         `json:"file"`
	Line         int            `json:"line"`
	Attributes   map[string]any `json:"attributes"`
	NestedBlocks map[string]any `json:"nested_blocks,omitempty"`
	References   []string       `json:"references,omitempty"`
}

type VariableRef struct {
	Name        string `json:"name"`
	VarType     string `json:"var_type"`
	DefaultJSON any    `json:"default_json,omitempty"`
	Sensitive   bool   `json:"sensitive"`
	Description string `json:"description,omitempty"`
	File        string `json:"file"`
	Line        int    `json:"line"`
}

type OutputRef struct {
	Name      string `json:"name"`
	Sensitive bool   `json:"sensitive"`
	ValueRef  string `json:"value_ref"`
	File      string `json:"file"`
	Line      int    `json:"line"`
}

type ProviderRef struct {
	ProviderType string         `json:"provider_type"`
	Alias        string         `json:"alias,omitempty"`
	Attributes   map[string]any `json:"attributes"`
	File         string         `json:"file"`
	Line         int            `json:"line"`
}

type ParsedBlock struct {
	BlockType    string         `json:"block_type"`
	Labels       []string       `json:"labels"`
	File         string         `json:"file"`
	Line         int            `json:"line"`
	Attributes   map[string]any `json:"attributes"`
	NestedBlocks map[string]any `json:"nested_blocks,omitempty"`
}

type RemoteStateRef struct {
	Name           string         `json:"name"`
	Backend        string         `json:"backend"`
	Config         map[string]any `json:"config"`
	File           string         `json:"file"`
	Line           int            `json:"line"`
	StateKey       string         `json:"state_key,omitempty"`
	TargetRepoHint string         `json:"target_repo_hint,omitempty"`
}

type TerragruntInclude struct {
	Path   string `json:"path"`
	Expose bool   `json:"expose"`
}

type TerragruntGenerate struct {
	Path            string `json:"path"`
	IfExists        string `json:"if_exists,omitempty"`
	ContentsSnippet string `json:"contents_snippet,omitempty"`
}

type TerragruntDependency struct {
	Name         string         `json:"name"`
	ConfigPath   string         `json:"config_path"`
	MockOutputs  map[string]any `json:"mock_outputs,omitempty"`
}

type TerragruntStack struct {
	Source       string                 `json:"source"`
	Dependencies []string               `json:"dependencies"`
	Includes     []TerragruntInclude    `json:"includes,omitempty"`
	Generate     []TerragruntGenerate   `json:"generate,omitempty"`
	DependencyBlocks []TerragruntDependency `json:"dependency_blocks,omitempty"`
	Inputs       map[string]any         `json:"inputs"`
	Locals       map[string]any         `json:"locals,omitempty"`
	File         string                 `json:"file"`
}

type ParseResult struct {
	RepoID           string            `json:"repo_id"`
	Modules          []ModuleRef       `json:"modules"`
	Resources        []ResourceRef     `json:"resources"`
	DataSources      []DataSourceRef   `json:"data_sources"`
	Variables        []VariableRef     `json:"variables"`
	Outputs          []OutputRef       `json:"outputs"`
	Providers        []ProviderRef     `json:"providers"`
	ParsedBlocks     []ParsedBlock     `json:"parsed_blocks"`
	RemoteStates     []RemoteStateRef  `json:"remote_states"`
	Stacks           []TerragruntStack `json:"stacks"`
	SecurityFindings []map[string]any  `json:"security_findings"`
	EOLSignals       []map[string]any  `json:"eol_signals"`
	RolloutSignals   []string          `json:"rollout_signals"`
}

type ImpactResult struct {
	ChangePlanID   string        `json:"change_plan_id"`
	UpstreamModule string        `json:"upstream_module"`
	FromVersion    string        `json:"from_version"`
	ToVersion      string        `json:"to_version"`
	RolloutPlans   []RolloutPlan `json:"rollout_plans"`
	AffectedRepos  []string      `json:"affected_repos"`
}

type RolloutPlan struct {
	ID               string           `json:"id"`
	DownstreamRepo   string           `json:"downstream_repo"`
	PinnedVersion    string           `json:"pinned_version"`
	TargetVersion    string           `json:"target_version"`
	Strategy         string           `json:"strategy"`
	StrategyReason   string           `json:"strategy_reason"`
	VersionGap       string           `json:"version_gap"`
	Phases           []map[string]any `json:"phases"`
	BreakingChanges  []map[string]any `json:"breaking_changes"`
	MockOutputsDrift []map[string]any `json:"mock_outputs_drift"`
	Rollback         string           `json:"rollback"`
}
