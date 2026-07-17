package graph

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/neo4j/neo4j-go-driver/v5/neo4j"

	"github.com/acme/infragraph/worker/internal/models"
)

type Writer struct {
	Driver neo4j.DriverWithContext
}

type WriteStats struct {
	Nodes int
	Edges int
}

// Stage 5: Graph materialization — Neo4j upsert.
func (w *Writer) Write(ctx context.Context, sub *models.RepoSubscription, parsed *models.ParseResult, subs []models.RepoSubscription) (*WriteStats, error) {
	stats := &WriteStats{}
	resolver := newSourceResolver(subs)
	session := w.Driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeWrite})
	defer session.Close(ctx)

	_, err := session.ExecuteWrite(ctx, func(tx neo4j.ManagedTransaction) (any, error) {
		_, err := tx.Run(ctx, `
			MERGE (r:Repository {id: $id})
			SET r.name = $name, r.role = $role, r.github_full_name = $gh,
			    r.appsvn = $appsvn, r.application_label = $appLabel, r.updated_at = datetime()
		`, map[string]any{
			"id": sub.ID, "name": sub.ID, "role": sub.Role, "gh": sub.GithubFullName,
			"appsvn": sub.Appsvn, "appLabel": sub.ApplicationLabel,
		})
		if err != nil {
			return nil, err
		}
		stats.Nodes++

		for _, m := range parsed.Modules {
			modID := moduleID(m.Source, m.Ref)
			_, err := tx.Run(ctx, `
				MERGE (mod:Module {id: $modID})
				SET mod.source = $source, mod.ref = $ref, mod.version = $version
				WITH mod
				MATCH (r:Repository {id: $repoID})
				MERGE (r)-[:CONTAINS_MODULE]->(mod)
			`, map[string]any{
				"modID": modID, "source": m.Source, "ref": m.Ref, "version": m.Version, "repoID": sub.ID,
			})
			if err != nil {
				return nil, err
			}
			stats.Nodes++
			stats.Edges++
			if upstream := resolver.resolve(m.Source); upstream != "" {
				_, err = tx.Run(ctx, `
					MATCH (mod:Module {id: $modID}), (ur:Repository {id: $upstreamID})
					MERGE (mod)-[:PROVIDED_BY]->(ur)
				`, map[string]any{"modID": modID, "upstreamID": upstream})
				if err != nil {
					return nil, err
				}
				stats.Edges++
			}
		}

		stackByFile := map[string]string{}
		for _, s := range parsed.Stacks {
			stackID := fmt.Sprintf("%s:%s", sub.ID, s.File)
			stackByFile[s.File] = stackID
			_, err := tx.Run(ctx, `
				MERGE (st:Stack {id: $stackID})
				SET st.file = $file, st.source = $source
				WITH st
				MATCH (r:Repository {id: $repoID})
				MERGE (r)-[:HAS_STACK]->(st)
			`, map[string]any{"stackID": stackID, "file": s.File, "source": s.Source, "repoID": sub.ID})
			if err != nil {
				return nil, err
			}
			stats.Nodes++
			stats.Edges++
			if s.Source != "" {
				modID := moduleID(s.Source, extractRef(s.Source))
				_, err = tx.Run(ctx, `
					MATCH (st:Stack {id: $stackID}), (mod:Module {id: $modID})
					MERGE (st)-[:REFERENCES_MODULE {ref: $ref}]->(mod)
					MERGE (st)-[:USES_MODULE {ref: $ref}]->(mod)
				`, map[string]any{"stackID": stackID, "modID": modID, "ref": extractRef(s.Source)})
				if err != nil {
					return nil, err
				}
				stats.Edges += 2
				if upstream := resolver.resolve(s.Source); upstream != "" {
					_, err = tx.Run(ctx, `
						MATCH (mod:Module {id: $modID}), (ur:Repository {id: $upstreamID})
						MERGE (mod)-[:PROVIDED_BY]->(ur)
					`, map[string]any{"modID": modID, "upstreamID": upstream})
					if err != nil {
						return nil, err
					}
					stats.Edges++
				}
			}
		}

		for _, s := range parsed.Stacks {
			stackID := stackByFile[s.File]
			for _, dep := range s.Dependencies {
				depStackFile := resolveStackFile(s.File, dep)
				depStackID := fmt.Sprintf("%s:%s", sub.ID, depStackFile)
				_, err := tx.Run(ctx, `
					MERGE (dst:Stack {id: $depStackID})
					ON CREATE SET dst.file = $depFile
					WITH dst
					MATCH (src:Stack {id: $stackID})
					MERGE (src)-[:DEPENDS_ON_STACK {path: $depPath}]->(dst)
				`, map[string]any{
					"stackID": stackID, "depStackID": depStackID,
					"depFile": depStackFile, "depPath": dep,
				})
				if err != nil {
					return nil, err
				}
				stats.Edges++
			}
		}

		for _, s := range parsed.Stacks {
			stackID := stackByFile[s.File]
			for _, inc := range s.Includes {
				incStackFile := resolveIncludeStackFile(s.File, inc.Path)
				incStackID := fmt.Sprintf("%s:%s", sub.ID, incStackFile)
				_, err := tx.Run(ctx, `
					MERGE (dst:Stack {id: $incStackID})
					ON CREATE SET dst.file = $incFile
					WITH dst
					MATCH (src:Stack {id: $stackID})
					MERGE (src)-[:INCLUDES {path: $path, expose: $expose}]->(dst)
				`, map[string]any{
					"stackID": stackID, "incStackID": incStackID,
					"incFile": incStackFile, "path": inc.Path, "expose": inc.Expose,
				})
				if err != nil {
					return nil, err
				}
				stats.Edges++
			}
		}

		dsByAddr := map[string]string{}
		for _, ds := range parsed.DataSources {
			addr := fmt.Sprintf("data.%s.%s", ds.Type, ds.Name)
			dsID := fmt.Sprintf("%s:%s", sub.ID, addr)
			dsByAddr[addr] = dsID
			_, err := tx.Run(ctx, `
				MERGE (d:DataSource {id: $dsID})
				SET d.type = $type, d.name = $name, d.file = $file, d.address = $address
				WITH d
				MATCH (r:Repository {id: $repoID})
				MERGE (r)-[:DECLARES]->(d)
			`, map[string]any{
				"dsID": dsID, "type": ds.Type, "name": ds.Name,
				"file": ds.File, "repoID": sub.ID, "address": addr,
			})
			if err != nil {
				return nil, err
			}
			stats.Nodes++
			stats.Edges++
		}

		for _, v := range parsed.Variables {
			varID := fmt.Sprintf("%s:var.%s", sub.ID, v.Name)
			_, err := tx.Run(ctx, `
				MERGE (vr:Variable {id: $varID})
				SET vr.name = $name, vr.var_type = $varType, vr.sensitive = $sensitive, vr.file = $file
				WITH vr
				MATCH (r:Repository {id: $repoID})
				MERGE (r)-[:DECLARES]->(vr)
			`, map[string]any{
				"varID": varID, "name": v.Name, "varType": v.VarType,
				"sensitive": v.Sensitive, "file": v.File, "repoID": sub.ID,
			})
			if err != nil {
				return nil, err
			}
			stats.Nodes++
			stats.Edges++
		}

		for _, o := range parsed.Outputs {
			outID := fmt.Sprintf("%s:output.%s", sub.ID, o.Name)
			_, err := tx.Run(ctx, `
				MERGE (out:Output {id: $outID})
				SET out.name = $name, out.sensitive = $sensitive, out.value_ref = $valueRef, out.file = $file
				WITH out
				MATCH (r:Repository {id: $repoID})
				MERGE (r)-[:DECLARES]->(out)
			`, map[string]any{
				"outID": outID, "name": o.Name, "sensitive": o.Sensitive,
				"valueRef": o.ValueRef, "file": o.File, "repoID": sub.ID,
			})
			if err != nil {
				return nil, err
			}
			stats.Nodes++
			stats.Edges++
		}

		for _, p := range parsed.Providers {
			provID := fmt.Sprintf("%s:provider.%s", sub.ID, p.ProviderType)
			if p.Alias != "" {
				provID = fmt.Sprintf("%s:provider.%s.%s", sub.ID, p.ProviderType, p.Alias)
			}
			_, err := tx.Run(ctx, `
				MERGE (pr:Provider {id: $provID})
				SET pr.provider_type = $ptype, pr.alias = $alias, pr.file = $file
				WITH pr
				MATCH (r:Repository {id: $repoID})
				MERGE (r)-[:DECLARES]->(pr)
			`, map[string]any{
				"provID": provID, "ptype": p.ProviderType, "alias": p.Alias,
				"file": p.File, "repoID": sub.ID,
			})
			if err != nil {
				return nil, err
			}
			stats.Nodes++
			stats.Edges++
		}

		for _, rs := range parsed.RemoteStates {
			stackID := stackByFile[rs.File]
			if stackID == "" {
				stackID = fmt.Sprintf("%s:%s", sub.ID, rs.File)
			}
			targetRepo := resolver.resolveRemoteState(rs, subs)
			if targetRepo != "" {
				_, err := tx.Run(ctx, `
					MATCH (src:Stack {id: $stackID}), (tgt:Repository {id: $targetRepo})
					MERGE (src)-[:READS_STATE_FROM {backend: $backend, state_key: $stateKey}]->(tgt)
				`, map[string]any{
					"stackID": stackID, "targetRepo": targetRepo,
					"backend": rs.Backend, "stateKey": rs.StateKey,
				})
				if err != nil {
					return nil, err
				}
				stats.Edges++
			} else if rs.TargetRepoHint != "" {
				_, err := tx.Run(ctx, `
					MATCH (src:Stack {id: $stackID})
					MERGE (tgt:Stack {id: $hintID})
					ON CREATE SET tgt.file = $hint
					MERGE (src)-[:READS_STATE_FROM {backend: $backend}]->(tgt)
				`, map[string]any{
					"stackID": stackID, "hintID": fmt.Sprintf("remote:%s", rs.TargetRepoHint),
					"hint": rs.TargetRepoHint, "backend": rs.Backend,
				})
				if err != nil {
					return nil, err
				}
				stats.Edges++
			}
		}

		resByAddr := map[string]string{}
		for _, res := range parsed.Resources {
			resID := fmt.Sprintf("%s:%s.%s", sub.ID, res.Type, res.Name)
			addr := fmt.Sprintf("%s.%s", res.Type, res.Name)
			resByAddr[addr] = resID
			appsvn := resolveAppsvn(res.Tags, sub.Appsvn)
			_, err := tx.Run(ctx, `
				MERGE (cr:CloudResource {id: $resID})
				SET cr.type = $type, cr.name = $name, cr.service_id = $svc, cr.file = $file,
				    cr.address = $address, cr.appsvn = $appsvn
				WITH cr
				MATCH (r:Repository {id: $repoID})
				MERGE (r)-[:DEPLOYS]->(cr)
			`, map[string]any{
				"resID": resID, "type": res.Type, "name": res.Name,
				"svc": res.ServiceID, "file": res.File, "repoID": sub.ID, "address": addr,
				"appsvn": appsvn,
			})
			if err != nil {
				return nil, err
			}
			stats.Nodes++
			stats.Edges++
		}

		for _, res := range parsed.Resources {
			fromAddr := fmt.Sprintf("%s.%s", res.Type, res.Name)
			fromID := fmt.Sprintf("%s:%s", sub.ID, fromAddr)
			for _, dep := range res.DependsOn {
				norm := normalizeResourceRef(dep)
				toID, ok := resByAddr[norm]
				if !ok {
					toID, ok = resByAddr[dep]
				}
				if !ok {
					toID = fmt.Sprintf("%s:%s", sub.ID, norm)
				}
				_, err := tx.Run(ctx, `
					MERGE (dst:CloudResource {id: $toID})
					ON CREATE SET dst.address = $depAddr
					WITH dst
					MATCH (src:CloudResource {id: $fromID})
					MERGE (src)-[:DEPENDS_ON]->(dst)
				`, map[string]any{"fromID": fromID, "toID": toID, "depAddr": norm})
				if err != nil {
					return nil, err
				}
				stats.Edges++
			}
			for _, ref := range res.References {
				norm := normalizeResourceRef(ref)
				if strings.HasPrefix(norm, "data.") {
					toID, ok := dsByAddr[norm]
					if !ok {
						toID, ok = dsByAddr[ref]
					}
					if !ok {
						toID = fmt.Sprintf("%s:%s", sub.ID, norm)
					}
					_, err := tx.Run(ctx, `
						MATCH (src:CloudResource {id: $fromID})
						MERGE (dst:DataSource {id: $toID})
						ON CREATE SET dst.address = $refAddr
						MERGE (src)-[:REFERENCES {raw: $raw}]->(dst)
					`, map[string]any{"fromID": fromID, "toID": toID, "refAddr": norm, "raw": ref})
					if err != nil {
						return nil, err
					}
					stats.Edges++
					continue
				}
				if strings.HasPrefix(norm, "module.") || strings.HasPrefix(norm, "var.") {
					continue
				}
				toID, ok := resByAddr[norm]
				if !ok {
					continue
				}
				_, err := tx.Run(ctx, `
					MATCH (src:CloudResource {id: $fromID}), (dst:CloudResource {id: $toID})
					MERGE (src)-[:REFERENCES {raw: $raw}]->(dst)
				`, map[string]any{"fromID": fromID, "toID": toID, "raw": ref})
				if err != nil {
					return nil, err
				}
				stats.Edges++
			}

			// Typed cloud topology edges (IN_VPC, USES_SG, ATTACHED_TO, HAS_CIDR, ALLOWS_CIDR, …)
			for _, se := range semanticEdgesFromResource(res, fromAddr) {
				if strings.HasPrefix(se.ToAddr, "cidr:") {
					cidrRel := se.RelType
					if cidrRel != "HAS_CIDR" && cidrRel != "ALLOWS_CIDR" {
						cidrRel = "ALLOWS_CIDR"
					}
					cidrID := fmt.Sprintf("%s:%s", sub.ID, se.ToAddr)
					_, err := tx.Run(ctx, fmt.Sprintf(`
						MERGE (c:CIDRBlock {id: $cidrID})
						SET c.cidr = $cidr, c.repo_id = $repoID
						WITH c
						MATCH (src:CloudResource {id: $fromID})
						MERGE (src)-[rel:%s]->(c)
						SET rel.attr = $attr
					`, cidrRel), map[string]any{
						"cidrID": cidrID, "cidr": se.Detail, "repoID": sub.ID,
						"fromID": fromID, "attr": se.Attr,
					})
					if err != nil {
						return nil, err
					}
					stats.Nodes++
					stats.Edges++
					continue
				}
				toID, ok := resByAddr[se.ToAddr]
				if !ok {
					// ATTACHED_TO may use fromAddr that isn't the attachment resource
					fromAlt, okFrom := resByAddr[se.FromAddr]
					toAlt, okTo := resByAddr[se.ToAddr]
					if se.RelType == "ATTACHED_TO" && okFrom && okTo {
						_, err := tx.Run(ctx, `
							MATCH (src:CloudResource {id: $fromID}), (dst:CloudResource {id: $toID})
							MERGE (src)-[rel:ATTACHED_TO]->(dst)
							SET rel.attr = $attr
						`, map[string]any{"fromID": fromAlt, "toID": toAlt, "attr": se.Attr})
						if err != nil {
							return nil, err
						}
						stats.Edges++
					}
					continue
				}
				srcID := fromID
				if se.FromAddr != fromAddr {
					if alt, ok := resByAddr[se.FromAddr]; ok {
						srcID = alt
					} else {
						continue
					}
				}
				_, err := tx.Run(ctx, fmt.Sprintf(`
					MATCH (src:CloudResource {id: $fromID}), (dst:CloudResource {id: $toID})
					MERGE (src)-[rel:%s]->(dst)
					SET rel.attr = $attr
				`, se.RelType), map[string]any{"fromID": srcID, "toID": toID, "attr": se.Attr})
				if err != nil {
					return nil, err
				}
				stats.Edges++
			}
		}

		for _, f := range parsed.SecurityFindings {
			_, err := tx.Run(ctx, `
				MERGE (sf:SecurityFinding {id: $id})
				SET sf.type = $type, sf.severity = $severity, sf.file = $file
				WITH sf MATCH (r:Repository {id: $repoID}) MERGE (r)-[:HAS_FINDING]->(sf)
			`, map[string]any{
				"id": fmt.Sprintf("%s:%v", sub.ID, f["type"]),
				"type": f["type"], "severity": f["severity"], "file": f["file"], "repoID": sub.ID,
			})
			if err != nil {
				return nil, err
			}
			stats.Nodes++
			stats.Edges++
		}
		return nil, nil
	})
	return stats, err
}

type sourceResolver struct {
	byBasename map[string]string
	byGithub   map[string]string
}

func newSourceResolver(subs []models.RepoSubscription) *sourceResolver {
	r := &sourceResolver{byBasename: map[string]string{}, byGithub: map[string]string{}}
	for _, s := range subs {
		r.byBasename[s.ID] = s.ID
		if s.LocalPath != "" {
			r.byBasename[filepath.Base(s.LocalPath)] = s.ID
		}
		if s.GithubFullName != "" {
			r.byGithub[s.GithubFullName] = s.ID
			parts := strings.Split(s.GithubFullName, "/")
			if len(parts) == 2 {
				r.byBasename[parts[1]] = s.ID
			}
		}
	}
	return r
}

func (r *sourceResolver) resolve(source string) string {
	if source == "" {
		return ""
	}
	for gh, id := range r.byGithub {
		if strings.Contains(source, gh) {
			return id
		}
	}
	base := sourceBasename(source)
	if id, ok := r.byBasename[base]; ok {
		return id
	}
	return ""
}

func sourceBasename(source string) string {
	source = strings.TrimSuffix(source, "/")
	if i := strings.Index(source, "?"); i >= 0 {
		source = source[:i]
	}
	if i := strings.LastIndex(source, "//"); i >= 0 {
		source = source[i+2:]
	}
	source = strings.TrimPrefix(source, "../")
	source = strings.TrimPrefix(source, "./")
	return filepath.Base(source)
}

func resolveStackFile(stackFile, depPath string) string {
	depPath = strings.TrimSuffix(depPath, "/")
	if strings.HasSuffix(depPath, "terragrunt.hcl") {
		return depPath
	}
	base := filepath.Dir(stackFile)
	resolved := filepath.ToSlash(filepath.Clean(filepath.Join(base, depPath, "terragrunt.hcl")))
	return resolved
}

func resolveIncludeStackFile(stackFile, includePath string) string {
	if strings.HasSuffix(includePath, ".hcl") {
		base := filepath.Dir(stackFile)
		return filepath.ToSlash(filepath.Clean(filepath.Join(base, includePath)))
	}
	base := filepath.Dir(stackFile)
	return filepath.ToSlash(filepath.Clean(filepath.Join(base, includePath, "terragrunt.hcl")))
}

func (r *sourceResolver) resolveRemoteState(rs models.RemoteStateRef, subs []models.RepoSubscription) string {
	if rs.StateKey != "" {
		for _, s := range subs {
			if strings.Contains(rs.StateKey, s.ID) {
				return s.ID
			}
		}
	}
	if rs.TargetRepoHint != "" {
		for _, s := range subs {
			if strings.Contains(rs.TargetRepoHint, s.ID) || strings.Contains(rs.TargetRepoHint, s.GithubFullName) {
				return s.ID
			}
		}
	}
	return ""
}

func moduleID(source, ref string) string {
	if ref != "" {
		return source + "@" + ref
	}
	return source
}

func extractRef(source string) string {
	if i := strings.Index(source, "?ref="); i >= 0 {
		return strings.Trim(source[i+5:], `"`)
	}
	if i := strings.Index(source, "ref="); i >= 0 {
		return source[i+4:]
	}
	return ""
}

func resolveAppsvn(tags map[string]string, repoAppsvn string) string {
	if tags != nil {
		for _, key := range []string{"APPSVN", "Appsvn", "appsvn", "AppSVN"} {
			if v := strings.TrimSpace(tags[key]); v != "" {
				return v
			}
		}
	}
	return repoAppsvn
}
