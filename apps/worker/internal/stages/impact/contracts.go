package impact

import (
	"encoding/json"
	"os"
	"path/filepath"
)

type contractVar struct {
	Name        string `json:"name"`
	Type        string `json:"type"`
	Default     any    `json:"default"`
	Sensitive   bool   `json:"sensitive"`
	Description string `json:"description"`
}

type contractOutput struct {
	Name        string `json:"name"`
	Sensitive   bool   `json:"sensitive"`
	Description string `json:"description"`
}

type contractRelease struct {
	Version   string           `json:"version"`
	Variables []contractVar    `json:"variables"`
	Outputs   []contractOutput `json:"outputs"`
}

type contractModule struct {
	ModuleID       string            `json:"module_id"`
	GithubFullName string            `json:"github_full_name"`
	SourceMatch    []string          `json:"source_match"`
	Releases       []contractRelease `json:"releases"`
}

type contractsSeed struct {
	Modules []contractModule `json:"modules"`
}

type ContractDiff struct {
	Variables struct {
		Added         []contractVar            `json:"added"`
		Removed       []contractVar            `json:"removed"`
		MadeMandatory []map[string]any         `json:"made_mandatory"`
		Changed       []map[string]any         `json:"changed"`
	} `json:"variables"`
	Outputs struct {
		Added   []contractOutput `json:"added"`
		Removed []contractOutput `json:"removed"`
	} `json:"outputs"`
	Summary map[string]int `json:"summary"`
}

func isMandatory(v contractVar) bool {
	return v.Default == nil
}

func defaultsEqual(a, b any) bool {
	ab, _ := json.Marshal(a)
	bb, _ := json.Marshal(b)
	return string(ab) == string(bb)
}

func loadContractsSeed(root string) (*contractsSeed, error) {
	path := filepath.Join(root, "config", "release-contracts", "seed.json")
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var seed contractsSeed
	if err := json.Unmarshal(data, &seed); err != nil {
		return nil, err
	}
	return &seed, nil
}

func findRelease(mod *contractModule, version string) *contractRelease {
	for i := range mod.Releases {
		if mod.Releases[i].Version == version {
			return &mod.Releases[i]
		}
	}
	return nil
}

func findModule(seed *contractsSeed, upstreamRepoID, githubFullName string) *contractModule {
	for i := range seed.Modules {
		m := &seed.Modules[i]
		if m.ModuleID == upstreamRepoID {
			return m
		}
		if githubFullName != "" && m.GithubFullName == githubFullName {
			return m
		}
	}
	return nil
}

func DiffContracts(from, to *contractRelease) ContractDiff {
	var diff ContractDiff
	fromVars := map[string]contractVar{}
	toVars := map[string]contractVar{}
	for _, v := range from.Variables {
		fromVars[v.Name] = v
	}
	for _, v := range to.Variables {
		toVars[v.Name] = v
	}

	for name, tv := range toVars {
		fv, ok := fromVars[name]
		if !ok {
			diff.Variables.Added = append(diff.Variables.Added, tv)
			continue
		}
		changes := []string{}
		if fv.Type != tv.Type {
			changes = append(changes, "type")
		}
		if !defaultsEqual(fv.Default, tv.Default) {
			changes = append(changes, "default")
		}
		if fv.Description != tv.Description {
			changes = append(changes, "description")
		}
		if fv.Sensitive != tv.Sensitive {
			changes = append(changes, "sensitive")
		}
		if !isMandatory(fv) && isMandatory(tv) {
			diff.Variables.MadeMandatory = append(diff.Variables.MadeMandatory, map[string]any{
				"name": name, "from": fv, "to": tv,
			})
		} else if len(changes) > 0 {
			diff.Variables.Changed = append(diff.Variables.Changed, map[string]any{
				"name": name, "changes": changes, "from": fv, "to": tv,
			})
		}
	}
	for name, fv := range fromVars {
		if _, ok := toVars[name]; !ok {
			diff.Variables.Removed = append(diff.Variables.Removed, fv)
		}
	}

	fromOut := map[string]contractOutput{}
	toOut := map[string]contractOutput{}
	for _, o := range from.Outputs {
		fromOut[o.Name] = o
	}
	for _, o := range to.Outputs {
		toOut[o.Name] = o
	}
	for name, o := range toOut {
		if _, ok := fromOut[name]; !ok {
			diff.Outputs.Added = append(diff.Outputs.Added, o)
		}
	}
	for name, o := range fromOut {
		if _, ok := toOut[name]; !ok {
			diff.Outputs.Removed = append(diff.Outputs.Removed, o)
		}
	}

	newRequired := 0
	for _, v := range diff.Variables.Added {
		if isMandatory(v) {
			newRequired++
		}
	}
	diff.Summary = map[string]int{
		"added":           len(diff.Variables.Added),
		"removed":         len(diff.Variables.Removed),
		"made_mandatory":  len(diff.Variables.MadeMandatory),
		"changed":         len(diff.Variables.Changed),
		"outputs_added":   len(diff.Outputs.Added),
		"outputs_removed": len(diff.Outputs.Removed),
		"breaking":        len(diff.Variables.Removed) + len(diff.Variables.MadeMandatory) + newRequired,
	}
	return diff
}

// DiffModuleVersions loads seed contracts and diffs from→to for an upstream module.
func DiffModuleVersions(root, upstreamRepoID, githubFullName, fromVersion, toVersion string) (*ContractDiff, error) {
	seed, err := loadContractsSeed(root)
	if err != nil {
		return nil, err
	}
	mod := findModule(seed, upstreamRepoID, githubFullName)
	if mod == nil {
		empty := ContractDiff{Summary: map[string]int{}}
		return &empty, nil
	}
	from := findRelease(mod, fromVersion)
	to := findRelease(mod, toVersion)
	if from == nil || to == nil {
		empty := ContractDiff{Summary: map[string]int{}}
		return &empty, nil
	}
	d := DiffContracts(from, to)
	return &d, nil
}
