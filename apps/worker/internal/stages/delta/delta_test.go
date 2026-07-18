package delta_test

import (
	"testing"

	"github.com/acme/infragraph/worker/internal/stages/delta"
)

func TestFilterAndClose_ExpandsModuleDir(t *testing.T) {
	changed := []string{"modules/vpc/variables.tf"}
	all := []string{
		"modules/vpc/variables.tf",
		"modules/vpc/main.tf",
		"modules/vpc/outputs.tf",
		"other/stack/main.tf",
	}
	out := delta.FilterAndClose(changed, []string{"**/*.tf"}, all)
	found := map[string]bool{}
	for _, f := range out {
		found[f] = true
	}
	if !found["modules/vpc/main.tf"] || !found["modules/vpc/outputs.tf"] {
		t.Fatalf("expected dependent closure in modules/vpc, got %#v", out)
	}
	if found["other/stack/main.tf"] {
		t.Fatalf("should not include unrelated stack: %#v", out)
	}
}

func TestInterfaceTouching(t *testing.T) {
	if !delta.InterfaceTouching([]string{"modules/vpc/variables.tf"}) {
		t.Fatal("expected interface touch")
	}
	if delta.InterfaceTouching([]string{"README.md"}) {
		t.Fatal("README should not count as interface")
	}
}
