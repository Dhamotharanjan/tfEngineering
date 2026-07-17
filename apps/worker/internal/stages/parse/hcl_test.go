package parse_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/acme/infragraph/worker/internal/config"
	"github.com/acme/infragraph/worker/internal/stages/parse"
)

func loadTestProfile(t *testing.T) *config.ScanProfile {
	t.Helper()
	root := findRepoRoot(t)
	loader := &config.Loader{Root: root}
	profile, err := loader.LoadScanProfileByID("enterprise-aws-default")
	if err != nil {
		t.Fatalf("load profile: %v", err)
	}
	return profile
}

func findRepoRoot(t *testing.T) string {
	t.Helper()
	dir, _ := os.Getwd()
	for {
		if _, err := os.Stat(filepath.Join(dir, "config", "scan-profiles.json")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			t.Fatal("could not find repo root")
		}
		dir = parent
	}
}

func testdataPath(name string) string {
	return filepath.Join("testdata", name)
}

func TestParseNestedSecurityGroup(t *testing.T) {
	profile := loadTestProfile(t)
	dir := t.TempDir()
	copyFile(t, testdataPath("nested_security_group.tf"), filepath.Join(dir, "main.tf"))

	result, err := parse.ParseRepoWithProfile(dir, "test-repo", profile)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if len(result.Resources) != 2 {
		t.Fatalf("expected 2 resources, got %d", len(result.Resources))
	}

	var sg *struct {
		tags map[string]string
		nest map[string]any
		refs []string
	}
	for i := range result.Resources {
		r := &result.Resources[i]
		if r.Type == "aws_security_group" && r.Name == "web" {
			sg = &struct {
				tags map[string]string
				nest map[string]any
				refs []string
			}{r.Tags, r.NestedBlocks, r.References}
		}
	}
	if sg == nil {
		t.Fatal("aws_security_group.web not found")
	}
	if sg.tags["Environment"] != "production" {
		t.Errorf("tags.Environment = %q, want production", sg.tags["Environment"])
	}
	if sg.tags["Owner"] != "platform-team" {
		t.Errorf("tags.Owner = %q, want platform-team", sg.tags["Owner"])
	}
	if len(sg.nest) < 2 {
		t.Fatalf("expected nested ingress/egress blocks, got %d", len(sg.nest))
	}
	hasIngress := false
	for k := range sg.nest {
		if strings.Contains(k, "ingress") {
			hasIngress = true
		}
	}
	if !hasIngress {
		t.Error("expected ingress nested block path")
	}
	hasVPCRef := false
	for _, ref := range sg.refs {
		if ref == "aws_vpc.core.id" || strings.HasPrefix(ref, "aws_vpc.core") {
			hasVPCRef = true
		}
	}
	if !hasVPCRef {
		t.Errorf("expected aws_vpc.core reference, got %v", sg.refs)
	}
}

func TestParseTerragruntFull(t *testing.T) {
	profile := loadTestProfile(t)
	dir := t.TempDir()
	copyFile(t, testdataPath("terragrunt_full.hcl"), filepath.Join(dir, "terragrunt.hcl"))

	result, err := parse.ParseRepoWithProfile(dir, "test-repo", profile)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if len(result.Stacks) != 1 {
		t.Fatalf("expected 1 stack, got %d", len(result.Stacks))
	}
	stack := result.Stacks[0]
	if !strings.Contains(stack.Source, "terraform-modules") {
		t.Errorf("source = %q", stack.Source)
	}
	if len(stack.Includes) != 1 || stack.Includes[0].Path == "" {
		t.Errorf("includes = %+v", stack.Includes)
	}
	if len(stack.DependencyBlocks) != 1 {
		t.Fatalf("dependency blocks = %d", len(stack.DependencyBlocks))
	}
	if stack.DependencyBlocks[0].ConfigPath != "../network" {
		t.Errorf("config_path = %q", stack.DependencyBlocks[0].ConfigPath)
	}
	if stack.DependencyBlocks[0].MockOutputs["vpc_id"] != "vpc-mock-12345" {
		t.Errorf("mock_outputs = %+v", stack.DependencyBlocks[0].MockOutputs)
	}
	if len(stack.Generate) != 1 || stack.Generate[0].Path != "provider.tf" {
		t.Errorf("generate = %+v", stack.Generate)
	}
	if _, ok := stack.Inputs["db_password"]; ok {
		t.Error("db_password should be redacted from inputs")
	}
	if stack.Inputs["instance_count"] != float64(3) && stack.Inputs["instance_count"] != 3 {
		t.Errorf("instance_count = %v", stack.Inputs["instance_count"])
	}
}

func TestParseModuleWithForEach(t *testing.T) {
	profile := loadTestProfile(t)
	dir := t.TempDir()
	copyFile(t, testdataPath("module_with_foreach.tf"), filepath.Join(dir, "main.tf"))

	result, err := parse.ParseRepoWithProfile(dir, "test-repo", profile)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if len(result.Modules) != 1 {
		t.Fatalf("expected 1 module, got %d", len(result.Modules))
	}
	if result.Modules[0].ForEach == "" {
		t.Error("expected for_each on module")
	}
	if len(result.Resources) < 2 {
		t.Fatalf("expected at least 2 resources, got %d", len(result.Resources))
	}
}

func TestParseRemoteState(t *testing.T) {
	profile := loadTestProfile(t)
	dir := t.TempDir()
	copyFile(t, testdataPath("remote_state.tf"), filepath.Join(dir, "main.tf"))

	result, err := parse.ParseRepoWithProfile(dir, "test-repo", profile)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if len(result.DataSources) != 1 {
		t.Fatalf("expected 1 data source, got %d", len(result.DataSources))
	}
	if result.DataSources[0].Type != "terraform_remote_state" {
		t.Errorf("data type = %q", result.DataSources[0].Type)
	}
	if len(result.RemoteStates) != 1 {
		t.Fatalf("expected 1 remote state ref, got %d", len(result.RemoteStates))
	}
	if result.RemoteStates[0].Backend != "s3" {
		t.Errorf("backend = %q", result.RemoteStates[0].Backend)
	}
	if !strings.Contains(result.RemoteStates[0].StateKey, "team-network") {
		t.Errorf("state_key = %q", result.RemoteStates[0].StateKey)
	}
}

func TestParseComplexConsumer(t *testing.T) {
	profile := loadTestProfile(t)
	dir := t.TempDir()
	copyFile(t, testdataPath("complex_consumer.tf"), filepath.Join(dir, "main.tf"))

	result, err := parse.ParseRepoWithProfile(dir, "test-repo", profile)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if len(result.Modules) < 2 {
		t.Fatalf("expected 2+ modules, got %d", len(result.Modules))
	}
	if len(result.Variables) < 2 {
		t.Fatalf("expected 2+ variables, got %d", len(result.Variables))
	}
	if len(result.Outputs) < 2 {
		t.Fatalf("expected 2+ outputs, got %d", len(result.Outputs))
	}
	if len(result.Providers) < 1 {
		t.Fatal("expected provider block")
	}

	var dbMod *struct{ depends []string }
	for i := range result.Modules {
		m := &result.Modules[i]
		if m.Name == "database" {
			dbMod = &struct{ depends []string }{nil}
			_ = dbMod
		}
	}

	hasSensitiveVar := false
	for _, v := range result.Variables {
		if v.Name == "db_password" {
			hasSensitiveVar = true
			if v.Sensitive != true {
				t.Error("db_password should be sensitive")
			}
		}
	}
	if !hasSensitiveVar {
		t.Error("db_password variable not found")
	}

	blockTypes := map[string]int{}
	for _, pb := range result.ParsedBlocks {
		blockTypes[pb.BlockType]++
	}
	for _, want := range []string{"module", "variable", "output", "provider", "terraform", "resource"} {
		if blockTypes[want] == 0 {
			t.Errorf("missing parsed block type %q", want)
		}
	}
}

func TestRedactionDenylist(t *testing.T) {
	profile := loadTestProfile(t)
	dir := t.TempDir()
	tf := `resource "aws_instance" "app" {
  ami           = "ami-123"
  instance_type = "t3.micro"
  user_data     = "secret bootstrap script"
  password      = "hunter2"
}`
	if err := os.WriteFile(filepath.Join(dir, "main.tf"), []byte(tf), 0644); err != nil {
		t.Fatal(err)
	}
	result, err := parse.ParseRepoWithProfile(dir, "test-repo", profile)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if len(result.Resources) != 1 {
		t.Fatalf("expected 1 resource")
	}
	attrs := result.Resources[0].Attributes
	if _, ok := attrs["user_data"]; ok {
		t.Error("user_data should be redacted per attribute_denylist")
	}
	if _, ok := attrs["password"]; ok {
		t.Error("password should be redacted")
	}
	if attrs["ami"] == nil {
		t.Error("ami should be present")
	}
}

func copyFile(t *testing.T, src, dst string) {
	t.Helper()
	data, err := os.ReadFile(src)
	if err != nil {
		t.Fatalf("read %s: %v", src, err)
	}
	if err := os.WriteFile(dst, data, 0644); err != nil {
		t.Fatalf("write %s: %v", dst, err)
	}
}
