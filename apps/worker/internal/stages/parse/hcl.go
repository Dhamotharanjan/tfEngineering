package parse

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/hashicorp/hcl/v2/hclparse"

	"github.com/acme/infragraph/worker/internal/config"
	"github.com/acme/infragraph/worker/internal/models"
)

// ParseOptions configures deep HCL parsing behavior from scan profiles.
type ParseOptions struct {
	Profile    *config.ScanProfile
	AllowFiles map[string]struct{} // if non-nil, only parse these relative paths
}

// Stage 3: Structural parse — deep HCL/Terragrunt extraction.
func ParseRepo(workDir, repoID string, opts *ParseOptions) (*models.ParseResult, error) {
	if opts == nil {
		opts = &ParseOptions{}
	}
	parser := hclparse.NewParser()
	result := &models.ParseResult{RepoID: repoID}

	err := filepath.Walk(workDir, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return err
		}
		lower := strings.ToLower(path)
		if !strings.HasSuffix(lower, ".tf") && !strings.HasSuffix(lower, ".hcl") {
			return nil
		}
		rel, _ := filepath.Rel(workDir, path)
		rel = filepath.ToSlash(rel)

		if opts.AllowFiles != nil {
			if _, ok := opts.AllowFiles[rel]; !ok {
				return nil
			}
		}

		if strings.HasSuffix(lower, "terragrunt.hcl") {
			stack, tgBlocks, err := parseTerragruntFile(parser, path, rel, opts.Profile)
			if err == nil && stack != nil {
				result.Stacks = append(result.Stacks, *stack)
				result.ParsedBlocks = append(result.ParsedBlocks, tgBlocks...)
				if stack.Source != "" {
					result.Modules = append(result.Modules, models.ModuleRef{
						Name:   stackModuleName(rel),
						Source: stack.Source,
						Ref:    extractRef(stack.Source),
						File:   rel,
					})
				}
			}
			return nil
		}

		mods, res, data, vars, outs, provs, blocks, remote, err := parseTerraformFile(parser, path, rel, opts.Profile)
		if err != nil {
			return nil // skip unparseable files
		}
		result.Modules = append(result.Modules, mods...)
		result.Resources = append(result.Resources, res...)
		result.DataSources = append(result.DataSources, data...)
		result.Variables = append(result.Variables, vars...)
		result.Outputs = append(result.Outputs, outs...)
		result.Providers = append(result.Providers, provs...)
		result.ParsedBlocks = append(result.ParsedBlocks, blocks...)
		result.RemoteStates = append(result.RemoteStates, remote...)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return result, nil
}

// ParseRepoWithProfile is a convenience wrapper used by the pipeline.
func ParseRepoWithProfile(workDir, repoID string, profile *config.ScanProfile) (*models.ParseResult, error) {
	return ParseRepo(workDir, repoID, &ParseOptions{Profile: profile})
}

// ParseRepoFiltered parses only the given relative file paths (incremental).
func ParseRepoFiltered(workDir, repoID string, profile *config.ScanProfile, files []string) (*models.ParseResult, error) {
	allow := make(map[string]struct{}, len(files))
	for _, f := range files {
		allow[filepath.ToSlash(f)] = struct{}{}
	}
	return ParseRepo(workDir, repoID, &ParseOptions{Profile: profile, AllowFiles: allow})
}

func FormatAddress(blockType string, labels []string) string {
	switch blockType {
	case "resource", "data":
		if len(labels) >= 2 {
			return fmt.Sprintf("%s.%s", labels[0], labels[1])
		}
	case "module":
		if len(labels) >= 1 {
			return fmt.Sprintf("module.%s", labels[0])
		}
	case "variable":
		if len(labels) >= 1 {
			return fmt.Sprintf("var.%s", labels[0])
		}
	case "output":
		if len(labels) >= 1 {
			return fmt.Sprintf("output.%s", labels[0])
		}
	}
	return strings.Join(labels, ".")
}
