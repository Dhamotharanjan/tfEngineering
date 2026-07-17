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
