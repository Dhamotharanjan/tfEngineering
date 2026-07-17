package graph

import (
	"testing"

	"github.com/acme/infragraph/worker/internal/models"
)

func TestNormalizeResourceRef(t *testing.T) {
	cases := map[string]string{
		"aws_vpc.core.id":                 "aws_vpc.core",
		"aws_subnet.private_a.id":         "aws_subnet.private_a",
		"aws_security_group.baseline.id":  "aws_security_group.baseline",
		"aws_ebs_volume.oracle_data.id":   "aws_ebs_volume.oracle_data",
		"aws_instance.oracle_app.id":      "aws_instance.oracle_app",
		"data.aws_ami.oracle.id":          "data.aws_ami.oracle",
		"aws_subnet.private[each.key].id": "aws_subnet.private",
		"module.network.vpc_id":           "module.network.vpc_id",
		"aws_vpc.core":                    "aws_vpc.core",
	}
	for in, want := range cases {
		got := normalizeResourceRef(in)
		if got != want {
			t.Errorf("normalizeResourceRef(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestSemanticEdgesVolumeAttachment(t *testing.T) {
	res := models.ResourceRef{
		Type: "aws_volume_attachment",
		Name: "oracle_data",
		Attributes: map[string]any{
			"volume_id":   "aws_ebs_volume.oracle_data.id",
			"instance_id": "aws_instance.oracle_app.id",
		},
	}
	edges := semanticEdgesFromResource(res, "aws_volume_attachment.oracle_data")
	found := false
	for _, e := range edges {
		if e.RelType == "ATTACHED_TO" && e.FromAddr == "aws_ebs_volume.oracle_data" && e.ToAddr == "aws_instance.oracle_app" {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected ATTACHED_TO edge, got %#v", edges)
	}
}

func TestSemanticEdgesSubnetInVPC(t *testing.T) {
	res := models.ResourceRef{
		Type: "aws_subnet",
		Name: "private_a",
		Attributes: map[string]any{
			"vpc_id":     "aws_vpc.core.id",
			"cidr_block": "10.20.1.0/24",
		},
	}
	edges := semanticEdgesFromResource(res, "aws_subnet.private_a")
	hasVPC, hasCIDR, allowsCIDR := false, false, false
	for _, e := range edges {
		if e.RelType == "IN_VPC" && e.ToAddr == "aws_vpc.core" {
			hasVPC = true
		}
		if e.RelType == "HAS_CIDR" && e.Detail == "10.20.1.0/24" {
			hasCIDR = true
		}
		if e.RelType == "ALLOWS_CIDR" {
			allowsCIDR = true
		}
	}
	if !hasVPC {
		t.Fatalf("expected IN_VPC, got %#v", edges)
	}
	if !hasCIDR {
		t.Fatalf("expected HAS_CIDR (not ALLOWS_CIDR) for subnet address space, got %#v", edges)
	}
	if allowsCIDR {
		t.Fatalf("subnet cidr_block must not create ALLOWS_CIDR, got %#v", edges)
	}
}

func TestSemanticEdgesInstanceUsesSG(t *testing.T) {
	res := models.ResourceRef{
		Type: "aws_instance",
		Name: "bastion",
		Attributes: map[string]any{
			"subnet_id":              "aws_subnet.private_a.id",
			"vpc_security_group_ids": []any{"aws_security_group.baseline.id"},
		},
	}
	edges := semanticEdgesFromResource(res, "aws_instance.bastion")
	hasSubnet, hasSG := false, false
	for _, e := range edges {
		if e.RelType == "IN_SUBNET" && e.ToAddr == "aws_subnet.private_a" {
			hasSubnet = true
		}
		if e.RelType == "USES_SG" && e.ToAddr == "aws_security_group.baseline" {
			hasSG = true
		}
	}
	if !hasSubnet || !hasSG {
		t.Fatalf("expected IN_SUBNET and USES_SG, got %#v", edges)
	}
}

func TestSemanticEdgesNestedSGIngressAllowsCIDR(t *testing.T) {
	res := models.ResourceRef{
		Type: "aws_security_group",
		Name: "web",
		Attributes: map[string]any{
			"vpc_id": "aws_vpc.core.id",
		},
		NestedBlocks: map[string]any{
			"ingress.0": map[string]any{
				"type":   "ingress",
				"labels": []any{},
				"attributes": map[string]any{
					"from_port":   "443",
					"to_port":     "443",
					"protocol":    "tcp",
					"cidr_blocks": []any{"0.0.0.0/0"},
				},
			},
			"egress.0": map[string]any{
				"type": "egress",
				"attributes": map[string]any{
					"cidr_blocks": []any{"10.0.0.0/8"},
				},
			},
		},
	}
	edges := semanticEdgesFromResource(res, "aws_security_group.web")
	hasVPC, hasAllowWorld, hasAllowPrivate := false, false, false
	for _, e := range edges {
		if e.RelType == "IN_VPC" && e.ToAddr == "aws_vpc.core" {
			hasVPC = true
		}
		if e.RelType == "ALLOWS_CIDR" && e.Detail == "0.0.0.0/0" {
			hasAllowWorld = true
		}
		if e.RelType == "ALLOWS_CIDR" && e.Detail == "10.0.0.0/8" {
			hasAllowPrivate = true
		}
		if e.RelType == "HAS_CIDR" {
			t.Fatalf("SG must not emit HAS_CIDR, got %#v", e)
		}
	}
	if !hasVPC || !hasAllowWorld || !hasAllowPrivate {
		t.Fatalf("expected IN_VPC + nested ALLOWS_CIDR edges, got %#v", edges)
	}
}

func TestSemanticEdgesNestedRouteVia(t *testing.T) {
	res := models.ResourceRef{
		Type: "aws_route_table",
		Name: "private",
		Attributes: map[string]any{
			"vpc_id": "aws_vpc.core.id",
		},
		NestedBlocks: map[string]any{
			"route.0": map[string]any{
				"type": "route",
				"attributes": map[string]any{
					"cidr_block":     "0.0.0.0/0",
					"nat_gateway_id": "aws_nat_gateway.main.id",
				},
			},
		},
	}
	edges := semanticEdgesFromResource(res, "aws_route_table.private")
	hasVia, hasAllow := false, false
	for _, e := range edges {
		if e.RelType == "ROUTES_VIA" && e.ToAddr == "aws_nat_gateway.main" {
			hasVia = true
		}
		if e.RelType == "ALLOWS_CIDR" && e.Detail == "0.0.0.0/0" {
			hasAllow = true
		}
		if e.RelType == "IN_VPC" && e.ToAddr == "aws_vpc.core" {
			// ok
		}
	}
	if !hasVia {
		t.Fatalf("expected ROUTES_VIA from nested route attributes, got %#v", edges)
	}
	if !hasAllow {
		t.Fatalf("expected ALLOWS_CIDR for route destination, got %#v", edges)
	}
}

func TestNestedAttrMap(t *testing.T) {
	wrapped := map[string]any{
		"type": "ingress",
		"attributes": map[string]any{
			"cidr_blocks": []any{"10.0.0.0/8"},
		},
	}
	got := nestedAttrMap(wrapped)
	if got == nil || got["cidr_blocks"] == nil {
		t.Fatalf("expected unwrapped attributes, got %#v", got)
	}
	flat := map[string]any{"nat_gateway_id": "aws_nat_gateway.main.id"}
	gotFlat := nestedAttrMap(flat)
	if gotFlat == nil || gotFlat["nat_gateway_id"] == nil {
		t.Fatalf("expected flat fallback, got %#v", gotFlat)
	}
}
