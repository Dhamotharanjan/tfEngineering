package parse

import (
	"fmt"
	"strings"

	"github.com/hashicorp/hcl/v2"
	"github.com/hashicorp/hcl/v2/hclsyntax"
	"github.com/zclconf/go-cty/cty"

	"github.com/acme/infragraph/worker/internal/config"
)

type extractCtx struct {
	profile  *config.ScanProfile
	allowSet map[string]bool
}

func newExtractCtx(profile *config.ScanProfile, allowKeys []string) *extractCtx {
	ctx := &extractCtx{profile: profile}
	if len(allowKeys) > 0 {
		ctx.allowSet = map[string]bool{}
		for _, k := range allowKeys {
			ctx.allowSet[k] = true
		}
	}
	return ctx
}

func (c *extractCtx) shouldStore(key string) bool {
	if c.profile != nil && c.profile.ShouldRedact(key) {
		return false
	}
	if c.profile != nil {
		for _, deny := range c.profile.TerraformScanFields.ResourceBlocks.AttributeDenylist {
			if strings.EqualFold(key, deny) {
				return false
			}
		}
	}
	if c.allowSet != nil && len(c.allowSet) > 0 {
		return c.allowSet[key]
	}
	return true
}

func extractBody(body hcl.Body, ctx *extractCtx, pathPrefix string) (map[string]any, map[string]any, []string) {
	attrs := map[string]any{}
	nested := map[string]any{}
	var refs []string

	synBody, ok := body.(*hclsyntax.Body)
	if !ok {
		justAttrs, _ := body.JustAttributes()
		for k, a := range justAttrs {
			if !ctx.shouldStore(k) {
				continue
			}
			attrs[k] = attrToValueHCL(a)
			refs = append(refs, extractExprRefs(a.Expr)...)
		}
		return attrs, nested, uniqueStrings(refs)
	}

	for k, a := range synBody.Attributes {
		if !ctx.shouldStore(k) {
			continue
		}
		attrs[k] = attrToValue(a)
		refs = append(refs, extractExprRefs(a.Expr)...)
	}

	for i, block := range synBody.Blocks {
		blockPath := blockPathKey(block, i, pathPrefix)
		blockAttrs, blockNested, blockRefs := extractBlock(block, ctx, blockPath)
		entry := map[string]any{
			"type":       block.Type,
			"labels":     block.Labels,
			"attributes": blockAttrs,
		}
		if len(blockNested) > 0 {
			entry["nested"] = blockNested
		}
		nested[blockPath] = entry
		refs = append(refs, blockRefs...)
	}

	return attrs, nested, uniqueStrings(refs)
}

func extractBlock(block *hclsyntax.Block, ctx *extractCtx, pathPrefix string) (map[string]any, map[string]any, []string) {
	return extractBody(block.Body, ctx, pathPrefix)
}

func blockPathKey(block *hclsyntax.Block, index int, prefix string) string {
	label := block.Type
	if len(block.Labels) > 0 {
		label += "." + strings.Join(block.Labels, ".")
	}
	if prefix != "" {
		return fmt.Sprintf("%s.%s[%d]", prefix, label, index)
	}
	return fmt.Sprintf("%s[%d]", label, index)
}

func attrToValue(a *hclsyntax.Attribute) any {
	if a == nil {
		return nil
	}
	return exprToValue(a.Expr)
}

func attrToValueHCL(a *hcl.Attribute) any {
	if a == nil {
		return nil
	}
	return exprToValue(a.Expr)
}

func bodyAttrStringList(body hcl.Body, name string) []string {
	if syn, ok := body.(*hclsyntax.Body); ok {
		if a, ok := syn.Attributes[name]; ok {
			return attrStringListFromExpr(a.Expr)
		}
		return nil
	}
	attrs, _ := body.JustAttributes()
	return attrStringList(attrs[name])
}

func exprToValue(expr hcl.Expression) any {
	if expr == nil {
		return nil
	}
	if obj, ok := expr.(*hclsyntax.ObjectConsExpr); ok {
		return objectConsToMap(obj)
	}
	if tuple, ok := expr.(*hclsyntax.TupleConsExpr); ok {
		return tupleConsToSlice(tuple)
	}
	if lit, ok := expr.(*hclsyntax.LiteralValueExpr); ok {
		return ctyToGo(lit.Val)
	}
	val, diags := expr.Value(nil)
	if diags.HasErrors() || !val.IsKnown() || val.IsNull() {
		return exprRawString(expr)
	}
	return ctyToGo(val)
}

func objectConsToMap(obj *hclsyntax.ObjectConsExpr) map[string]any {
	out := map[string]any{}
	for _, item := range obj.Items {
		key := objectKeyString(item.KeyExpr)
		if key == "" {
			continue
		}
		out[key] = exprToValue(item.ValueExpr)
	}
	return out
}

func tupleConsToSlice(tuple *hclsyntax.TupleConsExpr) []any {
	out := make([]any, 0, len(tuple.Exprs))
	for _, e := range tuple.Exprs {
		out = append(out, exprToValue(e))
	}
	return out
}

func objectKeyString(expr hcl.Expression) string {
	if lit, ok := expr.(*hclsyntax.LiteralValueExpr); ok && lit.Val.Type() == cty.String {
		return lit.Val.AsString()
	}
	val, diags := expr.Value(nil)
	if !diags.HasErrors() && val.IsKnown() && !val.IsNull() && val.Type() == cty.String {
		return val.AsString()
	}
	return ""
}

func ctyToGo(val cty.Value) any {
	switch {
	case val.Type() == cty.String:
		return val.AsString()
	case val.Type() == cty.Bool:
		return val.True()
	case val.Type() == cty.Number:
		bf := val.AsBigFloat()
		if bf.IsInt() {
			i, _ := bf.Int64()
			return int(i)
		}
		f, _ := bf.Float64()
		return f
	case val.Type().IsObjectType() || val.Type().IsMapType():
		out := map[string]any{}
		for it := val.ElementIterator(); it.Next(); {
			k, v := it.Element()
			out[k.AsString()] = ctyToGo(v)
		}
		return out
	case val.Type().IsTupleType(), val.Type().IsListType(), val.Type().IsSetType():
		var out []any
		for it := val.ElementIterator(); it.Next(); {
			_, v := it.Element()
			out = append(out, ctyToGo(v))
		}
		return out
	default:
		return val.GoString()
	}
}

func exprRawString(expr hcl.Expression) string {
	if expr == nil {
		return ""
	}
	switch e := expr.(type) {
	case *hclsyntax.ScopeTraversalExpr:
		return traversalString(e.Traversal)
	case *hclsyntax.RelativeTraversalExpr:
		base := exprRawString(e.Source)
		rel := traversalString(e.Traversal)
		switch {
		case base == "":
			return rel
		case rel == "":
			return base
		default:
			return base + "." + rel
		}
	case *hclsyntax.TemplateExpr:
		if len(e.Parts) == 1 {
			if lit, ok := e.Parts[0].(*hclsyntax.LiteralValueExpr); ok && lit.Val.Type() == cty.String {
				return lit.Val.AsString()
			}
		}
	case *hclsyntax.LiteralValueExpr:
		if e.Val.Type() == cty.String {
			return e.Val.AsString()
		}
		return e.Val.GoString()
	}
	// Prefer a single Terraform traversal over HCL range strings (file:line,col).
	if vars := expr.Variables(); len(vars) == 1 {
		return traversalString(vars[0])
	}
	return ""
}

func extractExprRefs(expr hcl.Expression) []string {
	if expr == nil {
		return nil
	}
	var refs []string
	for _, trav := range expr.Variables() {
		ref := traversalString(trav)
		if ref != "" && isTerraformRef(ref) {
			refs = append(refs, ref)
		}
	}
	return refs
}

func traversalString(trav hcl.Traversal) string {
	var parts []string
	for _, step := range trav {
		switch s := step.(type) {
		case hcl.TraverseRoot:
			parts = append(parts, s.Name)
		case hcl.TraverseAttr:
			parts = append(parts, s.Name)
		case hcl.TraverseIndex:
			if s.Key.Type() == cty.String && s.Key.IsKnown() {
				parts = append(parts, fmt.Sprintf("[%s]", s.Key.AsString()))
			} else if s.Key.Type() == cty.Number && s.Key.IsKnown() {
				f, _ := s.Key.AsBigFloat().Int64()
				parts = append(parts, fmt.Sprintf("[%d]", f))
			}
		}
	}
	return strings.Join(parts, ".")
}

func isTerraformRef(ref string) bool {
	if ref == "" {
		return false
	}
	// Skip local.*, var.*, each.*, count.* for dependency graph (keep var for rollout)
	if strings.HasPrefix(ref, "local.") || strings.HasPrefix(ref, "each.") || strings.HasPrefix(ref, "count.") {
		return false
	}
	return true
}

func extractTags(attrs map[string]any) map[string]string {
	tags := map[string]string{}
	raw, ok := attrs["tags"]
	if !ok {
		return tags
	}
	switch tm := raw.(type) {
	case map[string]any:
		for k, v := range tm {
			if s, ok := v.(string); ok {
				tags[k] = s
			}
		}
	case map[string]string:
		return tm
	}
	return tags
}

func attrStringListFromExpr(expr hcl.Expression) []string {
	if expr == nil {
		return nil
	}
	val, diags := expr.Value(nil)
	if diags.HasErrors() {
		raw := strings.Trim(expr.Range().String(), `"`)
		if raw != "" {
			return []string{raw}
		}
		return nil
	}
	if !val.IsKnown() || val.IsNull() {
		return nil
	}
	switch {
	case val.Type().IsTupleType(), val.Type().IsListType(), val.Type().IsSetType():
		var out []string
		for it := val.ElementIterator(); it.Next(); {
			_, ev := it.Element()
			if ev.Type() == cty.String && ev.IsKnown() && !ev.IsNull() {
				out = append(out, ev.AsString())
			}
		}
		return out
	case val.Type() == cty.String:
		return []string{val.AsString()}
	default:
		return nil
	}
}

func attrStringList(a *hcl.Attribute) []string {
	if a == nil {
		return nil
	}
	return attrStringListFromExpr(a.Expr)
}

func uniqueStrings(in []string) []string {
	seen := map[string]bool{}
	var out []string
	for _, s := range in {
		if s == "" || seen[s] {
			continue
		}
		seen[s] = true
		out = append(out, s)
	}
	return out
}

func collectAllRefs(attrs map[string]any, nested map[string]any) []string {
	var refs []string
	for _, v := range attrs {
		refs = append(refs, refsFromValue(v)...)
	}
	for _, v := range nested {
		if m, ok := v.(map[string]any); ok {
			if a, ok := m["attributes"].(map[string]any); ok {
				refs = append(refs, refsFromValueMap(a)...)
			}
			if n, ok := m["nested"].(map[string]any); ok {
				refs = append(refs, collectAllRefs(nil, n)...)
			}
		}
	}
	return uniqueStrings(refs)
}

func refsFromValueMap(m map[string]any) []string {
	var refs []string
	for _, v := range m {
		refs = append(refs, refsFromValue(v)...)
	}
	return refs
}

func refsFromValue(v any) []string {
	switch t := v.(type) {
	case string:
		// Interpolation references embedded in strings are captured via extractExprRefs at parse time.
		return nil
	case map[string]any:
		return refsFromValueMap(t)
	case []any:
		var refs []string
		for _, item := range t {
			refs = append(refs, refsFromValue(item)...)
		}
		return refs
	default:
		return nil
	}
}
