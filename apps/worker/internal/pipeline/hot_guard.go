package pipeline

import "fmt"

// HotScanTriggers are webhook/job triggers that MUST NOT enter runScan
// (graph write + indexed_sha advance). Phase 0: PR/tag are HOT-only.
var HotScanTriggers = map[string]struct{}{
	"pull_request":     {},
	"pr_impact_query":  {},
	"release_tag":      {},
	"tag_impact_query": {},
	"webhook_pr":       {},
}

// RefuseHotScanTrigger returns an error when payload.trigger is a HOT path.
// Call at the top of runScan so a mis-routed incremental_scan cannot rebuild the graph.
func RefuseHotScanTrigger(payload map[string]any) error {
	trigger := strPayload(payload, "trigger")
	if trigger == "" {
		return nil
	}
	if _, hot := HotScanTriggers[trigger]; hot {
		return fmt.Errorf(
			"refusing graph-writing scan for HOT trigger %q (PR/tag must use read-only impact path)",
			trigger,
		)
	}
	return nil
}
