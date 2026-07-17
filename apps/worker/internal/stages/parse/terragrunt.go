package parse

import (
	"fmt"
	"os"
	"strings"

	"github.com/hashicorp/hcl/v2/hclparse"
	"github.com/hashicorp/hcl/v2/hclsyntax"

	"github.com/acme/infragraph/worker/internal/config"
	"github.com/acme/infragraph/worker/internal/models"
)

func parseTerragruntFile(parser *hclparse.Parser, path, rel string, profile *config.ScanProfile) (*models.TerragruntStack, []models.ParsedBlock, error) {
	src, err := os.ReadFile(path)
	if err != nil {
		return nil, nil, err
	}
	file, diags := parser.ParseHCL(src, path)
	if diags.HasErrors() {
		return nil, nil, diags
	}

	ctx := newExtractCtx(profile, nil)
	stack := &models.TerragruntStack{File: rel, Inputs: map[string]any{}, Locals: map[string]any{}}
	var blocks []models.ParsedBlock

	synBody, ok := file.Body.(*hclsyntax.Body)
	if !ok {
		return parseTerragruntLegacy(parser, path, rel, profile)
	}

	for _, block := range synBody.Blocks {
		line := block.DefRange().Start.Line
		attrs, nested, _ := extractBody(block.Body, ctx, block.Type)

		switch block.Type {
		case "terraform":
			if profile == nil || profile.IsBlockEnabled("terraform") || profile.TerragruntScanFields.Source.Enabled {
				if v, ok := attrs["source"].(string); ok {
					stack.Source = v
				}
			}
			blocks = append(blocks, models.ParsedBlock{
				BlockType: "terraform", Labels: block.Labels, File: rel, Line: line,
				Attributes: attrs, NestedBlocks: nested,
			})

		case "dependency":
			if profile != nil && !profile.IsBlockEnabled("dependency") {
				continue
			}
			if len(block.Labels) < 1 {
				continue
			}
			dep := models.TerragruntDependency{Name: block.Labels[0]}
			if v, ok := attrs["config_path"].(string); ok {
				dep.ConfigPath = v
				stack.Dependencies = append(stack.Dependencies, v)
			}
			if mo, ok := attrs["mock_outputs"].(map[string]any); ok {
				dep.MockOutputs = mo
			}
			stack.DependencyBlocks = append(stack.DependencyBlocks, dep)
			blocks = append(blocks, models.ParsedBlock{
				BlockType: "dependency", Labels: block.Labels, File: rel, Line: line,
				Attributes: attrs, NestedBlocks: nested,
			})

		case "dependencies":
			if profile != nil && !profile.IsBlockEnabled("dependencies") {
				continue
			}
			if paths, ok := attrs["paths"].([]any); ok {
				for _, p := range paths {
					if s, ok := p.(string); ok {
						stack.Dependencies = append(stack.Dependencies, s)
					}
				}
			} else {
				stack.Dependencies = append(stack.Dependencies, bodyAttrStringList(block.Body, "paths")...)
			}
			blocks = append(blocks, models.ParsedBlock{
				BlockType: "dependencies", Labels: block.Labels, File: rel, Line: line,
				Attributes: attrs, NestedBlocks: nested,
			})

		case "include":
			if profile != nil && !profile.IsBlockEnabled("include") {
				continue
			}
			inc := models.TerragruntInclude{}
			if v, ok := attrs["path"].(string); ok {
				inc.Path = v
			}
			if v, ok := attrs["expose"].(bool); ok {
				inc.Expose = v
			}
			stack.Includes = append(stack.Includes, inc)
			blocks = append(blocks, models.ParsedBlock{
				BlockType: "include", Labels: block.Labels, File: rel, Line: line,
				Attributes: attrs, NestedBlocks: nested,
			})

		case "generate":
			if profile != nil && !profile.IsBlockEnabled("generate") {
				continue
			}
			gen := models.TerragruntGenerate{}
			if v, ok := attrs["path"].(string); ok {
				gen.Path = v
			}
			if v, ok := attrs["if_exists"].(string); ok {
				gen.IfExists = v
			}
			if v, ok := attrs["contents"].(string); ok {
				snippet := v
				if len(snippet) > 120 {
					snippet = snippet[:120] + "..."
				}
				gen.ContentsSnippet = snippet
			}
			stack.Generate = append(stack.Generate, gen)
			blocks = append(blocks, models.ParsedBlock{
				BlockType: "generate", Labels: block.Labels, File: rel, Line: line,
				Attributes: redactGenerateAttrs(attrs, profile), NestedBlocks: nested,
			})

		case "inputs":
			if profile != nil && !profile.IsBlockEnabled("inputs") {
				continue
			}
			for k, v := range attrs {
				if profile == nil || !profile.ShouldRedact(k) {
					stack.Inputs[k] = v
				}
			}
			blocks = append(blocks, models.ParsedBlock{
				BlockType: "inputs", Labels: block.Labels, File: rel, Line: line,
				Attributes: filterRedacted(attrs, profile), NestedBlocks: nested,
			})

		case "locals":
			if profile != nil && !profile.TerragruntScanFields.Locals.Enabled {
				continue
			}
			for k, v := range attrs {
				if profile == nil || !profile.ShouldRedact(k) {
					stack.Locals[k] = v
				}
			}
			blocks = append(blocks, models.ParsedBlock{
				BlockType: "locals", Labels: block.Labels, File: rel, Line: line,
				Attributes: filterRedacted(attrs, profile), NestedBlocks: nested,
			})
		}
	}

	// Top-level inputs attribute (some terragrunt files use inputs = { ... } as attribute)
	for k, a := range synBody.Attributes {
		if k == "inputs" && (profile == nil || profile.IsBlockEnabled("inputs")) {
			val := attrToValue(a)
			if m, ok := val.(map[string]any); ok {
				for ik, iv := range m {
					if profile == nil || !profile.ShouldRedact(ik) {
						stack.Inputs[ik] = iv
					}
				}
			}
		}
	}

	return stack, blocks, nil
}

func parseTerragruntLegacy(parser *hclparse.Parser, path, rel string, profile *config.ScanProfile) (*models.TerragruntStack, []models.ParsedBlock, error) {
	return nil, nil, fmt.Errorf("terragrunt legacy parse not supported for %s", rel)
}

func redactGenerateAttrs(attrs map[string]any, profile *config.ScanProfile) map[string]any {
	out := map[string]any{}
	for k, v := range attrs {
		if profile != nil && profile.ShouldRedact(k) {
			continue
		}
		out[k] = v
	}
	return out
}

func filterRedacted(attrs map[string]any, profile *config.ScanProfile) map[string]any {
	out := map[string]any{}
	for k, v := range attrs {
		if profile != nil && profile.ShouldRedact(k) {
			out[k] = "[REDACTED]"
			continue
		}
		out[k] = v
	}
	return out
}

func stackModuleName(rel string) string {
	base := rel
	if i := strings.LastIndex(base, "/"); i >= 0 {
		base = base[:i]
	}
	if i := strings.LastIndex(base, "/"); i >= 0 {
		return base[i+1:]
	}
	return strings.TrimSuffix(base, "/terragrunt.hcl")
}
