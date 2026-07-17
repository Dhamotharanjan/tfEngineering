package graph

import (
	"regexp"
	"strings"

	"github.com/acme/infragraph/worker/internal/models"
)

var (
	indexSegmentRe = regexp.MustCompile(`\[[^\]]*\]`)
)

// normalizeResourceRef turns HCL traversals into resource addresses.
// aws_vpc.core.id → aws_vpc.core
// aws_subnet.private[each.key].id → aws_subnet.private
// data.aws_ami.x.id → data.aws_ami.x
func normalizeResourceRef(ref string) string {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return ""
	}
	ref = indexSegmentRe.ReplaceAllString(ref, "")

	if strings.HasPrefix(ref, "data.") {
		parts := strings.Split(ref, ".")
		if len(parts) >= 3 {
			return strings.Join(parts[:3], ".")
		}
		return ref
	}
	if strings.HasPrefix(ref, "module.") || strings.HasPrefix(ref, "var.") || strings.HasPrefix(ref, "local.") {
		return ref
	}

	parts := strings.Split(ref, ".")
	if len(parts) >= 2 {
		return parts[0] + "." + parts[1]
	}
	return ref
}

type semanticEdge struct {
	FromAddr string
	ToAddr   string
	RelType  string
	Attr     string
	Detail   string
}

// nestedAttrMap unwraps parse output nested blocks shaped as
// { type, labels, attributes: {...}, nested?: {...} }.
// Falls back to treating the map itself as attributes (flat / test fixtures).
func nestedAttrMap(raw any) map[string]any {
	m, ok := raw.(map[string]any)
	if !ok || m == nil {
		return nil
	}
	if attrs, ok := m["attributes"].(map[string]any); ok && attrs != nil {
		return attrs
	}
	// Flat attribute map (no "attributes" wrapper)
	if _, hasType := m["type"]; hasType {
		return nil
	}
	return m
}

func nestedBlockType(raw any) string {
	m, ok := raw.(map[string]any)
	if !ok {
		return ""
	}
	t, _ := m["type"].(string)
	return t
}

// semanticEdgesFromResource derives typed cloud topology edges from attributes
// and nested blocks (IN_VPC, IN_SUBNET, USES_SG, ATTACHED_TO, HAS_CIDR, ALLOWS_CIDR, ROUTES_VIA).
func semanticEdgesFromResource(res models.ResourceRef, fromAddr string) []semanticEdge {
	var out []semanticEdge
	attrs := res.Attributes
	if attrs == nil {
		attrs = map[string]any{}
	}

	addAttrRef := func(attr, rel string) {
		for _, raw := range attrRefStrings(attrs[attr]) {
			to := normalizeResourceRef(raw)
			if to == "" || to == fromAddr {
				continue
			}
			if strings.HasPrefix(to, "module.") || strings.HasPrefix(to, "var.") || strings.HasPrefix(to, "local.") {
				continue
			}
			out = append(out, semanticEdge{FromAddr: fromAddr, ToAddr: to, RelType: rel, Attr: attr})
		}
	}

	switch {
	case res.Type == "aws_subnet" || res.Type == "aws_security_group" ||
		res.Type == "aws_internet_gateway" || res.Type == "aws_route_table" ||
		res.Type == "aws_nat_gateway" || res.Type == "aws_lb" || res.Type == "aws_db_subnet_group":
		addAttrRef("vpc_id", "IN_VPC")
	}

	addAttrRef("subnet_id", "IN_SUBNET")
	addAttrRef("vpc_security_group_id", "USES_SG")
	addAttrRef("security_groups", "USES_SG")
	addAttrRef("vpc_security_group_ids", "USES_SG")

	if res.Type == "aws_volume_attachment" {
		vols := attrRefStrings(attrs["volume_id"])
		insts := attrRefStrings(attrs["instance_id"])
		for _, v := range vols {
			for _, i := range insts {
				va := normalizeResourceRef(v)
				ia := normalizeResourceRef(i)
				if va != "" && ia != "" {
					out = append(out, semanticEdge{FromAddr: va, ToAddr: ia, RelType: "ATTACHED_TO", Attr: "volume_attachment"})
				}
			}
		}
	}

	if res.Type == "aws_route" || res.Type == "aws_route_table" {
		addAttrRef("nat_gateway_id", "ROUTES_VIA")
		addAttrRef("gateway_id", "ROUTES_VIA")
		addAttrRef("route_table_id", "USES_ROUTE_TABLE")
	}
	if res.Type == "aws_route_table_association" {
		addAttrRef("subnet_id", "IN_SUBNET")
		addAttrRef("route_table_id", "USES_ROUTE_TABLE")
	}
	if res.Type == "aws_nat_gateway" {
		addAttrRef("subnet_id", "IN_SUBNET")
	}

	// Ownership CIDRs (VPC/subnet declare address space) — HAS_CIDR, not ALLOWS_CIDR
	if res.Type == "aws_vpc" || res.Type == "aws_subnet" {
		for _, cidr := range collectCIDRs(attrs, nil) {
			out = append(out, semanticEdge{
				FromAddr: fromAddr,
				ToAddr:   "cidr:" + cidr,
				RelType:  "HAS_CIDR",
				Attr:     "cidr_block",
				Detail:   cidr,
			})
		}
	}

	// Nested route { nat_gateway_id = ... } inside route_table
	for path, raw := range res.NestedBlocks {
		attrsMap := nestedAttrMap(raw)
		if attrsMap == nil {
			continue
		}
		blockType := nestedBlockType(raw)
		lowerPath := strings.ToLower(path)
		isRoute := blockType == "route" ||
			(strings.Contains(lowerPath, "route") && !strings.Contains(lowerPath, "route_table"))
		if !isRoute {
			continue
		}
		for _, key := range []string{"nat_gateway_id", "gateway_id"} {
			for _, rawRef := range attrRefStrings(attrsMap[key]) {
				to := normalizeResourceRef(rawRef)
				if to != "" && !strings.HasPrefix(to, "module.") {
					out = append(out, semanticEdge{FromAddr: fromAddr, ToAddr: to, RelType: "ROUTES_VIA", Attr: key})
				}
			}
		}
		for _, cidr := range collectCIDRs(attrsMap, nil) {
			out = append(out, semanticEdge{
				FromAddr: fromAddr, ToAddr: "cidr:" + cidr, RelType: "ALLOWS_CIDR", Attr: "route", Detail: cidr,
			})
		}
	}

	// Nested SG rules: ALLOWS_CIDR from ingress/egress only (not subnet/vpc cidr_block)
	for path, raw := range res.NestedBlocks {
		attrsMap := nestedAttrMap(raw)
		if attrsMap == nil {
			continue
		}
		blockType := nestedBlockType(raw)
		lower := strings.ToLower(path + " " + blockType)
		if !strings.Contains(lower, "ingress") && !strings.Contains(lower, "egress") {
			continue
		}
		for _, cidr := range collectCIDRs(attrsMap, nil) {
			out = append(out, semanticEdge{
				FromAddr: fromAddr,
				ToAddr:   "cidr:" + cidr,
				RelType:  "ALLOWS_CIDR",
				Attr:     blockType,
				Detail:   cidr,
			})
		}
		for _, key := range []string{"security_groups", "source_security_group_id"} {
			for _, rawRef := range attrRefStrings(attrsMap[key]) {
				to := normalizeResourceRef(rawRef)
				if to != "" && !strings.HasPrefix(to, "module.") {
					rel := "INGRESS_FROM_SG"
					if strings.Contains(lower, "egress") {
						rel = "EGRESS_TO_SG"
					}
					out = append(out, semanticEdge{FromAddr: fromAddr, ToAddr: to, RelType: rel, Attr: key})
				}
			}
		}
	}
	return out
}

func attrRefStrings(v any) []string {
	switch t := v.(type) {
	case string:
		if looksLikeTFRef(t) {
			return []string{t}
		}
	case []any:
		var out []string
		for _, item := range t {
			out = append(out, attrRefStrings(item)...)
		}
		return out
	case []string:
		var out []string
		for _, item := range t {
			if looksLikeTFRef(item) {
				out = append(out, item)
			}
		}
		return out
	}
	return nil
}

func looksLikeTFRef(s string) bool {
	s = strings.TrimSpace(s)
	if s == "" {
		return false
	}
	return strings.HasPrefix(s, "aws_") ||
		strings.HasPrefix(s, "data.") ||
		strings.HasPrefix(s, "module.")
}

func collectCIDRs(attrs map[string]any, nested map[string]any) []string {
	seen := map[string]bool{}
	var out []string
	add := func(s string) {
		s = strings.TrimSpace(s)
		if s == "" || !strings.Contains(s, "/") {
			return
		}
		// skip HCL refs
		if strings.HasPrefix(s, "aws_") || strings.HasPrefix(s, "var.") || strings.HasPrefix(s, "module.") {
			return
		}
		if seen[s] {
			return
		}
		seen[s] = true
		out = append(out, s)
	}
	pull := func(m map[string]any) {
		if m == nil {
			return
		}
		for _, key := range []string{"cidr_block", "cidr_blocks"} {
			switch v := m[key].(type) {
			case string:
				add(v)
			case []any:
				for _, item := range v {
					if s, ok := item.(string); ok {
						add(s)
					}
				}
			case []string:
				for _, s := range v {
					add(s)
				}
			}
		}
	}
	pull(attrs)
	for _, raw := range nested {
		if m := nestedAttrMap(raw); m != nil {
			pull(m)
		}
	}
	return out
}
