package impact

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

// fetchGitHubReleaseNotes loads release body when webhook did not include notes.
func fetchGitHubReleaseNotes(githubFullName, tag string) string {
	githubFullName = strings.TrimSpace(githubFullName)
	tag = strings.TrimSpace(tag)
	if githubFullName == "" || tag == "" {
		return ""
	}
	token := os.Getenv("GITHUB_TOKEN")
	if token == "" {
		token = os.Getenv("GH_TOKEN")
	}
	host := os.Getenv("GITHUB_HOST")
	apiHost := "api.github.com"
	if host != "" && host != "github.com" {
		apiHost = host + "/api/v3"
	}
	url := fmt.Sprintf("https://%s/repos/%s/releases/tags/%s", apiHost, githubFullName, tag)
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return ""
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	client := &http.Client{Timeout: 12 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		return ""
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return ""
	}
	body, err := io.ReadAll(io.LimitReader(res.Body, 512*1024))
	if err != nil {
		return ""
	}
	var payload struct {
		Name string `json:"name"`
		Body string `json:"body"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return ""
	}
	notes := strings.TrimSpace(payload.Body)
	if notes == "" && payload.Name != "" {
		return payload.Name
	}
	return notes
}
