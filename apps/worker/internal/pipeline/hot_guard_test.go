package pipeline

import "testing"

func TestRefuseHotScanTrigger(t *testing.T) {
	cases := []struct {
		trigger string
		refuse  bool
	}{
		{"pull_request", true},
		{"pr_impact_query", true},
		{"release_tag", true},
		{"tag_impact_query", true},
		{"webhook_push", false},
		{"push_default_branch", false},
		{"", false},
	}
	for _, tc := range cases {
		err := RefuseHotScanTrigger(map[string]any{"trigger": tc.trigger})
		if tc.refuse && err == nil {
			t.Fatalf("trigger %q: expected refusal", tc.trigger)
		}
		if !tc.refuse && err != nil {
			t.Fatalf("trigger %q: unexpected error %v", tc.trigger, err)
		}
	}
}
