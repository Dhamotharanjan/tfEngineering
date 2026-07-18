package delta

import (
	"path/filepath"
	"strings"

	"github.com/acme/infragraph/worker/internal/config"
)

// FilterAndClose takes git-changed paths, applies scan-profile path filters,
// then expands dependent IaC files in the same module/stack directories.
func FilterAndClose(changed []string, filters []string, allRepoFiles []string) []string {
	if len(changed) == 0 {
		return nil
	}
	matched := make(map[string]struct{})
	for _, f := range changed {
		f = filepath.ToSlash(f)
		if matchAny(f, filters) {
			matched[f] = struct{}{}
		}
	}
	if len(matched) == 0 {
		return nil
	}

	// Dependent closure: same directory + sibling .tf/.hcl + parent terragrunt.hcl
	dirs := make(map[string]struct{})
	for f := range matched {
		dir := filepath.ToSlash(filepath.Dir(f))
		dirs[dir] = struct{}{}
		// Parent dirs up to 2 levels (TG stacks often nest)
		parent := filepath.ToSlash(filepath.Dir(dir))
		if parent != "." && parent != "" {
			dirs[parent] = struct{}{}
		}
	}

	for _, f := range allRepoFiles {
		f = filepath.ToSlash(f)
		lower := strings.ToLower(f)
		if !strings.HasSuffix(lower, ".tf") && !strings.HasSuffix(lower, ".hcl") {
			continue
		}
		dir := filepath.ToSlash(filepath.Dir(f))
		if _, ok := dirs[dir]; ok {
			matched[f] = struct{}{}
		}
		base := filepath.Base(f)
		if strings.EqualFold(base, "terragrunt.hcl") {
			if _, ok := dirs[dir]; ok {
				matched[f] = struct{}{}
			}
		}
	}

	out := make([]string, 0, len(matched))
	for f := range matched {
		out = append(out, f)
	}
	return out
}

func matchAny(path string, filters []string) bool {
	if len(filters) == 0 {
		return isIaC(path)
	}
	for _, pat := range filters {
		if matchGlob(pat, path) {
			return true
		}
	}
	return false
}

func isIaC(path string) bool {
	lower := strings.ToLower(path)
	return strings.HasSuffix(lower, ".tf") || strings.HasSuffix(lower, ".hcl")
}

// matchGlob supports **/*.tf style and simple suffix/contains patterns.
func matchGlob(pattern, path string) bool {
	pattern = filepath.ToSlash(pattern)
	path = filepath.ToSlash(path)
	if pattern == "**/*.tf" {
		return strings.HasSuffix(strings.ToLower(path), ".tf")
	}
	if pattern == "**/*.hcl" {
		return strings.HasSuffix(strings.ToLower(path), ".hcl")
	}
	if strings.HasPrefix(pattern, "**/") {
		suf := strings.TrimPrefix(pattern, "**/")
		if strings.Contains(suf, "*") {
			suf = strings.ReplaceAll(suf, "*", "")
			return strings.Contains(strings.ToLower(path), strings.ToLower(suf))
		}
		return strings.HasSuffix(path, suf) || strings.Contains(path, "/"+suf)
	}
	return path == pattern || strings.HasSuffix(path, pattern)
}

// InterfaceTouching returns true when changed files look like a published module interface.
func InterfaceTouching(files []string) bool {
	for _, f := range files {
		base := strings.ToLower(filepath.Base(f))
		switch base {
		case "variables.tf", "outputs.tf", "versions.tf", "main.tf":
			return true
		}
		if strings.Contains(strings.ToLower(f), "/modules/") && strings.HasSuffix(base, ".tf") {
			return true
		}
	}
	return false
}

// DefaultFilters from profile or built-in.
func DefaultFilters(profile *config.ScanProfile) []string {
	if profile != nil {
		return profile.PathFiltersForPush()
	}
	return []string{"**/*.tf", "**/*.hcl"}
}
