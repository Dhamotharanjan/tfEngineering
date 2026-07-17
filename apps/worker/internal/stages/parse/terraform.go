package parse

import (
	"os"
	"strings"

	"github.com/hashicorp/hcl/v2"
	"github.com/hashicorp/hcl/v2/hclparse"
	"github.com/hashicorp/hcl/v2/hclsyntax"

	"github.com/acme/infragraph/worker/internal/config"
	"github.com/acme/infragraph/worker/internal/models"
)

func parseTerraformFile(parser *hclparse.Parser, path, rel string, profile *config.ScanProfile) (
	modules []models.ModuleRef,
	resources []models.ResourceRef,
	dataSources []models.DataSourceRef,
	variables []models.VariableRef,
	outputs []models.OutputRef,
	providers []models.ProviderRef,
	parsedBlocks []models.ParsedBlock,
	remoteStates []models.RemoteStateRef,
	err error,
) {
	src, err := os.ReadFile(path)
	if err != nil {
		return nil, nil, nil, nil, nil, nil, nil, nil, err
	}
	file, diags := parser.ParseHCL(src, path)
	if diags.HasErrors() {
		return nil, nil, nil, nil, nil, nil, nil, nil, diags
	}

	synFile, ok := file.Body.(*hclsyntax.Body)
	if !ok {
		return parseTerraformLegacy(parser, path, rel, profile)
	}

	ctx := newExtractCtx(profile, nil)

	for _, block := range synFile.Blocks {
		line := block.DefRange().Start.Line
		switch block.Type {
		case "module":
			if profile != nil && !profile.IsBlockEnabled("module") {
				continue
			}
			if len(block.Labels) < 1 {
				continue
			}
			attrs, nested, refs := extractBody(block.Body, ctx, "module")
			m := models.ModuleRef{
				Name: block.Labels[0], File: rel, Line: line,
			}
			if v, ok := attrs["source"].(string); ok {
				m.Source = v
				m.Ref = extractRef(v)
			}
			if v, ok := attrs["version"].(string); ok {
				m.Version = v
			}
			if v, ok := attrs["count"].(string); ok {
				m.Count = v
			}
			if v, ok := attrs["for_each"].(string); ok {
				m.ForEach = v
			}
			if p, ok := attrs["providers"]; ok {
				m.Providers = map[string]any{"raw": p}
			}
			_ = nested
			_ = refs
			modules = append(modules, m)
			parsedBlocks = append(parsedBlocks, models.ParsedBlock{
				BlockType: "module", Labels: block.Labels, File: rel, Line: line,
				Attributes: attrs, NestedBlocks: nested,
			})

		case "resource":
			if profile != nil && !profile.IsBlockEnabled("resource") {
				continue
			}
			if len(block.Labels) < 2 {
				continue
			}
			attrs, nested, refs := extractBody(block.Body, ctx, "resource")
			r := models.ResourceRef{
				Type: block.Labels[0], Name: block.Labels[1],
				File: rel, Line: line,
				Attributes: attrs, NestedBlocks: nested, References: refs,
				Tags: extractTags(attrs),
			}
			if dep, ok := attrs["depends_on"].([]any); ok {
				for _, d := range dep {
					if s, ok := d.(string); ok {
						r.DependsOn = append(r.DependsOn, s)
					}
				}
			} else if dep, ok := attrs["depends_on"].([]string); ok {
				r.DependsOn = dep
			}
			if len(r.DependsOn) == 0 {
				r.DependsOn = bodyAttrStringList(block.Body, "depends_on")
			}
			r.References = uniqueStrings(append(r.References, collectAllRefs(attrs, nested)...))
			resources = append(resources, r)
			parsedBlocks = append(parsedBlocks, models.ParsedBlock{
				BlockType: "resource", Labels: block.Labels, File: rel, Line: line,
				Attributes: attrs, NestedBlocks: nested,
			})

		case "data":
			if profile != nil && !profile.IsBlockEnabled("data") {
				continue
			}
			if len(block.Labels) < 2 {
				continue
			}
			attrs, nested, refs := extractBody(block.Body, ctx, "data")
			ds := models.DataSourceRef{
				Type: block.Labels[0], Name: block.Labels[1],
				File: rel, Line: line,
				Attributes: attrs, NestedBlocks: nested, References: refs,
			}
			ds.References = uniqueStrings(append(ds.References, collectAllRefs(attrs, nested)...))
			dataSources = append(dataSources, ds)
			parsedBlocks = append(parsedBlocks, models.ParsedBlock{
				BlockType: "data", Labels: block.Labels, File: rel, Line: line,
				Attributes: attrs, NestedBlocks: nested,
			})

			if block.Labels[0] == "terraform_remote_state" {
				rs := models.RemoteStateRef{
					Name: block.Labels[1], File: rel, Line: line, Config: map[string]any{},
				}
				if b, ok := attrs["backend"].(string); ok {
					rs.Backend = b
				}
				if cfg, ok := attrs["config"].(map[string]any); ok {
					applyRemoteStateConfig(&rs, cfg)
				} else {
					for _, v := range nested {
						if m, ok := v.(map[string]any); ok {
							if t, _ := m["type"].(string); t == "config" {
								if a, ok := m["attributes"].(map[string]any); ok {
									applyRemoteStateConfig(&rs, a)
								}
							}
						}
					}
				}
				for k, v := range attrs {
					if k == "backend" || k == "config" {
						continue
					}
					rs.Config[k] = v
				}
				remoteStates = append(remoteStates, rs)
			}

		case "variable":
			if profile != nil && !profile.IsBlockEnabled("variable") {
				continue
			}
			if len(block.Labels) < 1 {
				continue
			}
			attrs, nested, _ := extractBody(block.Body, ctx, "variable")
			v := models.VariableRef{Name: block.Labels[0], File: rel, Line: line}
			if t, ok := attrs["type"].(string); ok {
				v.VarType = t
			}
			if d, ok := attrs["default"]; ok {
				v.DefaultJSON = d
			}
			if s, ok := attrs["sensitive"].(bool); ok {
				v.Sensitive = s
			}
			if desc, ok := attrs["description"].(string); ok {
				v.Description = desc
			}
			_ = nested
			variables = append(variables, v)
			parsedBlocks = append(parsedBlocks, models.ParsedBlock{
				BlockType: "variable", Labels: block.Labels, File: rel, Line: line,
				Attributes: attrs, NestedBlocks: nested,
			})

		case "output":
			if profile != nil && !profile.IsBlockEnabled("output") {
				continue
			}
			if len(block.Labels) < 1 {
				continue
			}
			attrs, nested, refs := extractBody(block.Body, ctx, "output")
			o := models.OutputRef{Name: block.Labels[0], File: rel, Line: line}
			if s, ok := attrs["sensitive"].(bool); ok {
				o.Sensitive = s
			}
			if len(refs) > 0 {
				o.ValueRef = refs[0]
			} else if v, ok := attrs["value"].(string); ok {
				o.ValueRef = v
			}
			outputs = append(outputs, o)
			parsedBlocks = append(parsedBlocks, models.ParsedBlock{
				BlockType: "output", Labels: block.Labels, File: rel, Line: line,
				Attributes: attrs, NestedBlocks: nested,
			})

		case "provider":
			if profile != nil && !profile.IsBlockEnabled("provider") {
				continue
			}
			if len(block.Labels) < 1 {
				continue
			}
			attrs, nested, _ := extractBody(block.Body, ctx, "provider")
			p := models.ProviderRef{
				ProviderType: block.Labels[0], File: rel, Line: line, Attributes: attrs,
			}
			if a, ok := attrs["alias"].(string); ok {
				p.Alias = a
			}
			_ = nested
			providers = append(providers, p)
			parsedBlocks = append(parsedBlocks, models.ParsedBlock{
				BlockType: "provider", Labels: block.Labels, File: rel, Line: line,
				Attributes: attrs, NestedBlocks: nested,
			})

		case "terraform":
			attrs, nested, _ := extractBody(block.Body, ctx, "terraform")
			parsedBlocks = append(parsedBlocks, models.ParsedBlock{
				BlockType: "terraform", Labels: block.Labels, File: rel, Line: line,
				Attributes: attrs, NestedBlocks: nested,
			})
			// Extract required_providers / backend from nested blocks
			for _, v := range nested {
				if m, ok := v.(map[string]any); ok {
					if t, _ := m["type"].(string); t == "backend" {
						if labels, ok := m["labels"].([]string); ok && len(labels) > 0 {
							_ = labels
						}
					}
				}
			}

		case "locals":
			attrs, nested, _ := extractBody(block.Body, ctx, "locals")
			parsedBlocks = append(parsedBlocks, models.ParsedBlock{
				BlockType: "locals", Labels: block.Labels, File: rel, Line: line,
				Attributes: attrs, NestedBlocks: nested,
			})
		}
	}
	return modules, resources, dataSources, variables, outputs, providers, parsedBlocks, remoteStates, nil
}

// parseTerraformLegacy falls back to PartialContent for non-hclsyntax bodies.
func parseTerraformLegacy(parser *hclparse.Parser, path, rel string, profile *config.ScanProfile) (
	[]models.ModuleRef, []models.ResourceRef, []models.DataSourceRef,
	[]models.VariableRef, []models.OutputRef, []models.ProviderRef,
	[]models.ParsedBlock, []models.RemoteStateRef, error,
) {
	src, _ := os.ReadFile(path)
	file, _ := parser.ParseHCL(src, path)
	schema := &hcl.BodySchema{
		Blocks: []hcl.BlockHeaderSchema{
			{Type: "module", LabelNames: []string{"name"}},
			{Type: "resource", LabelNames: []string{"type", "name"}},
			{Type: "data", LabelNames: []string{"type", "name"}},
			{Type: "variable", LabelNames: []string{"name"}},
			{Type: "output", LabelNames: []string{"name"}},
			{Type: "provider", LabelNames: []string{"type"}},
		},
	}
	content, _, _ := file.Body.PartialContent(schema)
	ctx := newExtractCtx(profile, nil)
	var modules []models.ModuleRef
	var resources []models.ResourceRef
	for _, b := range content.Blocks {
		switch b.Type {
		case "module":
			attrs, _, _ := extractBody(b.Body, ctx, "module")
			m := models.ModuleRef{Name: b.Labels[0], File: rel, Line: b.DefRange.Start.Line}
			if v, ok := attrs["source"].(string); ok {
				m.Source = v
			}
			modules = append(modules, m)
		case "resource":
			attrs, nested, refs := extractBody(b.Body, ctx, "resource")
			r := models.ResourceRef{
				Type: b.Labels[0], Name: b.Labels[1], File: rel, Line: b.DefRange.Start.Line,
				Attributes: attrs, NestedBlocks: nested, References: refs, Tags: extractTags(attrs),
			}
			resources = append(resources, r)
		}
	}
	return modules, resources, nil, nil, nil, nil, nil, nil, nil
}

func extractRef(source string) string {
	if i := strings.Index(source, "?ref="); i >= 0 {
		return strings.Trim(source[i+5:], `"`)
	}
	if i := strings.Index(source, "ref="); i >= 0 {
		return strings.Trim(source[i+4:], `"`)
	}
	return ""
}

func applyRemoteStateConfig(rs *models.RemoteStateRef, cfg map[string]any) {
	for ck, cv := range cfg {
		rs.Config[ck] = cv
	}
	if k, ok := cfg["key"].(string); ok {
		rs.StateKey = k
	}
	if b, ok := cfg["bucket"].(string); ok {
		rs.TargetRepoHint = b
	}
}
