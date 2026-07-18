package pipeline

import (
	"bytes"
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"time"
)

func notifyAIIngest(ctx context.Context, repoID string, body map[string]any) {
	url := os.Getenv("AI_SERVICE_URL")
	if url == "" {
		return
	}
	payload, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url+"/ingest/parse-result", bytes.NewReader(payload))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("ai ingest: %v", err)
		return
	}
	resp.Body.Close()
}

// notifyPatternInvalidate asks the AI service to refresh Milvus interactions for a repo after interface changes.
func notifyPatternInvalidate(ctx context.Context, repoID string, files []string) {
	base := os.Getenv("API_INTERNAL_URL")
	if base == "" {
		base = os.Getenv("AI_SERVICE_URL")
	}
	if base == "" {
		return
	}
	body := map[string]any{"repo_id": repoID, "files": files, "reason": "module_interface_change"}
	payload, _ := json.Marshal(body)
	// Prefer Nest API pattern sync if available; otherwise AI health no-op path.
	url := base + "/api/graph/patterns/interactions/sync"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("pattern invalidate: %v", err)
		return
	}
	resp.Body.Close()
}
