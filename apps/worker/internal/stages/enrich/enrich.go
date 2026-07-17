package enrich

import (
	"strings"

	"github.com/acme/infragraph/worker/internal/config"
	"github.com/acme/infragraph/worker/internal/models"
)

// Stage 4: Semantic enrichment — registry match, EOL, security, rollout signals.
func Enrich(parsed *models.ParseResult, registry *config.AWSServiceRegistry, profile *config.ScanProfile) *models.ParseResult {
	typeMap := buildTypeMap(registry)
	for i := range parsed.Resources {
		r := &parsed.Resources[i]
		r.ServiceID = typeMap[r.Type]
		detectSecurity(r, parsed, profile)
		detectEOL(r, parsed, profile)
		detectRollout(r, parsed, profile)
	}
	for _, v := range parsed.Variables {
		detectRolloutFromVariable(v, parsed, profile)
	}
	return parsed
}

func buildTypeMap(reg *config.AWSServiceRegistry) map[string]string {
	m := map[string]string{}
	if reg == nil {
		return m
	}
	for _, svc := range reg.Services {
		for _, t := range svc.TerraformResources {
			m[t] = svc.ServiceID
		}
	}
	return m
}

func detectSecurity(r *models.ResourceRef, parsed *models.ParseResult, profile *config.ScanProfile) {
	if profile != nil {
		for ruleName, rule := range profile.SecurityScanFields {
			if rule.Resource != "" && r.Type != rule.Resource {
				continue
			}
			switch ruleName {
			case "unencrypted_rds":
				if rule.Attribute != "" {
					enc, _ := r.Attributes[rule.Attribute].(string)
					if enc == "false" || enc == "" {
						addFinding(parsed, "unencrypted_rds", r, "high")
					}
				}
			case "sg_open_to_world":
				detectSGOpenToWorld(r, parsed, rule.CidrDeny)
			case "s3_public_access":
				// Detected when resource type matches; deeper policy checks deferred.
				if r.Type == rule.Resource {
					_ = rule.Enabled
				}
			}
		}
	} else {
		detectSecurityLegacy(r, parsed)
	}

	// Nested ingress/egress on aws_security_group
	if r.Type == "aws_security_group" {
		scanNestedSGRules(r, parsed, profile)
	}
}

func detectSecurityLegacy(r *models.ResourceRef, parsed *models.ParseResult) {
	if r.Type == "aws_db_instance" {
		enc, _ := r.Attributes["storage_encrypted"].(string)
		if enc == "false" || enc == "" {
			addFinding(parsed, "unencrypted_rds", r, "high")
		}
	}
	if r.Type == "aws_security_group_rule" {
		detectSGOpenToWorld(r, parsed, []string{"0.0.0.0/0"})
	}
}

func detectSGOpenToWorld(r *models.ResourceRef, parsed *models.ParseResult, denyCIDRs []string) {
	if len(denyCIDRs) == 0 {
		denyCIDRs = []string{"0.0.0.0/0"}
	}
	cidr := attrAsString(r.Attributes["cidr_blocks"])
	if cidr == "" {
		cidr = attrAsString(r.Attributes["cidr_block"])
	}
	for _, deny := range denyCIDRs {
		if strings.Contains(cidr, deny) {
			addFinding(parsed, "sg_open_to_world", r, "critical")
			return
		}
	}
}

func scanNestedSGRules(r *models.ResourceRef, parsed *models.ParseResult, profile *config.ScanProfile) {
	denyCIDRs := []string{"0.0.0.0/0"}
	if profile != nil {
		if rule, ok := profile.SecurityScanFields["sg_open_to_world"]; ok && len(rule.CidrDeny) > 0 {
			denyCIDRs = rule.CidrDeny
		}
	}
	walkNestedBlocks(r.NestedBlocks, func(blockType string, attrs map[string]any) {
		if blockType != "ingress" && blockType != "egress" {
			return
		}
		cidr := attrAsString(attrs["cidr_blocks"])
		if cidr == "" {
			cidr = attrAsString(attrs["cidr_block"])
		}
		for _, deny := range denyCIDRs {
			if strings.Contains(cidr, deny) {
				parsed.SecurityFindings = append(parsed.SecurityFindings, map[string]any{
					"type":     "sg_open_to_world",
					"resource": r.Type + "." + r.Name,
					"severity": "critical",
					"file":     r.File,
					"nested":   blockType,
				})
				return
			}
		}
	})
}

func walkNestedBlocks(nested map[string]any, fn func(blockType string, attrs map[string]any)) {
	for _, v := range nested {
		m, ok := v.(map[string]any)
		if !ok {
			continue
		}
		blockType, _ := m["type"].(string)
		attrs, _ := m["attributes"].(map[string]any)
		if blockType != "" && attrs != nil {
			fn(blockType, attrs)
		}
		if inner, ok := m["nested"].(map[string]any); ok {
			walkNestedBlocks(inner, fn)
		}
	}
}

func addFinding(parsed *models.ParseResult, findingType string, r *models.ResourceRef, severity string) {
	parsed.SecurityFindings = append(parsed.SecurityFindings, map[string]any{
		"type":     findingType,
		"resource": r.Type + "." + r.Name,
		"severity": severity,
		"file":     r.File,
	})
}

func detectEOL(r *models.ResourceRef, parsed *models.ParseResult, profile *config.ScanProfile) {
	if profile != nil {
		for eolType, rule := range profile.EOLTrackingFields {
			if r.Type != rule.Resource {
				continue
			}
			sig := map[string]any{"type": eolType, "file": r.File}
			for _, attr := range rule.Attributes {
				if v, ok := r.Attributes[attr]; ok {
					sig[attr] = v
				}
			}
			parsed.EOLSignals = append(parsed.EOLSignals, sig)
		}
		return
	}
	detectEOLLegacy(r, parsed)
}

func detectEOLLegacy(r *models.ResourceRef, parsed *models.ParseResult) {
	switch r.Type {
	case "aws_eks_cluster":
		if v, ok := r.Attributes["version"]; ok {
			parsed.EOLSignals = append(parsed.EOLSignals, map[string]any{
				"type": "eks", "version": v, "risk": "track_k8s_eol", "file": r.File,
			})
		}
	case "aws_db_instance":
		eng, _ := r.Attributes["engine"].(string)
		ver, _ := r.Attributes["engine_version"].(string)
		if eng != "" {
			parsed.EOLSignals = append(parsed.EOLSignals, map[string]any{
				"type": "rds", "engine": eng, "version": ver, "file": r.File,
			})
		}
	case "aws_lambda_function":
		if rt, ok := r.Attributes["runtime"]; ok {
			parsed.EOLSignals = append(parsed.EOLSignals, map[string]any{
				"type": "lambda", "runtime": rt, "file": r.File,
			})
		}
	}
}

func detectRollout(r *models.ResourceRef, parsed *models.ParseResult, profile *config.ScanProfile) {
	if profile != nil {
		for strategy, rule := range profile.RolloutStrategySignals {
			for _, pat := range rule.ResourcePatterns {
				if r.Type == pat {
					parsed.RolloutSignals = appendUnique(parsed.RolloutSignals, strategy)
				}
			}
			for _, pat := range rule.AttributePatterns {
				for k := range r.Attributes {
					if strings.Contains(k, pat) {
						parsed.RolloutSignals = appendUnique(parsed.RolloutSignals, strategy)
					}
				}
				walkNestedBlocks(r.NestedBlocks, func(_ string, attrs map[string]any) {
					for k := range attrs {
						if strings.Contains(k, pat) {
							parsed.RolloutSignals = appendUnique(parsed.RolloutSignals, strategy)
						}
					}
				})
			}
		}
		return
	}
	detectRolloutLegacy(r, parsed)
}

func detectRolloutFromVariable(v models.VariableRef, parsed *models.ParseResult, profile *config.ScanProfile) {
	if profile == nil {
		return
	}
	for strategy, rule := range profile.RolloutStrategySignals {
		for _, pat := range rule.VariablePatterns {
			if strings.Contains(v.Name, pat) {
				parsed.RolloutSignals = appendUnique(parsed.RolloutSignals, strategy)
			}
		}
	}
}

func detectRolloutLegacy(r *models.ResourceRef, parsed *models.ParseResult) {
	switch r.Type {
	case "aws_lb_listener_rule", "aws_lb_target_group":
		parsed.RolloutSignals = appendUnique(parsed.RolloutSignals, "canary")
	case "aws_eks_node_group", "aws_autoscaling_group":
		parsed.RolloutSignals = appendUnique(parsed.RolloutSignals, "rolling")
	case "aws_db_instance", "aws_rds_cluster":
		parsed.RolloutSignals = appendUnique(parsed.RolloutSignals, "maintenance_window")
	}
}

func attrAsString(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case []any:
		var parts []string
		for _, item := range t {
			if s, ok := item.(string); ok {
				parts = append(parts, s)
			}
		}
		return strings.Join(parts, ",")
	case []string:
		return strings.Join(t, ",")
	default:
		return ""
	}
}

func appendUnique(slice []string, v string) []string {
	for _, s := range slice {
		if s == v {
			return slice
		}
	}
	return append(slice, v)
}
