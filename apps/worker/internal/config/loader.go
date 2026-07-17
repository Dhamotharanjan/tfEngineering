package config

import (
	"encoding/json"
	"os"
	"path/filepath"

	"github.com/acme/infragraph/worker/internal/models"
)

type Loader struct {
	Root string
}

type SubscriptionsFile struct {
	Repos []models.RepoSubscription `json:"repos"`
}

type AWSServiceRegistry struct {
	Services []struct {
		ServiceID          string   `json:"service_id"`
		TerraformResources []string `json:"terraform_resources"`
		KeyAttributes      []string `json:"key_attributes"`
	} `json:"services"`
}

func (l *Loader) LoadSubscriptions() ([]models.RepoSubscription, error) {
	path := filepath.Join(l.Root, "config", "repo-subscriptions.json")
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var f SubscriptionsFile
	if err := json.Unmarshal(data, &f); err != nil {
		return nil, err
	}
	return f.Repos, nil
}

func (l *Loader) GetSubscription(repoID string) (*models.RepoSubscription, error) {
	repos, err := l.LoadSubscriptions()
	if err != nil {
		return nil, err
	}
	for _, r := range repos {
		if r.ID == repoID && r.Subscribed {
			return &r, nil
		}
	}
	return nil, nil
}

func (l *Loader) LoadScanProfile() (map[string]any, error) {
	path := filepath.Join(l.Root, "config", "scan-profiles.json")
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var profile map[string]any
	if err := json.Unmarshal(data, &profile); err != nil {
		return nil, err
	}
	return profile, nil
}

func (l *Loader) LoadAWSRegistry() (*AWSServiceRegistry, error) {
	path := filepath.Join(l.Root, "registry", "vendors", "aws", "aws-service-registry.json")
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var reg AWSServiceRegistry
	if err := json.Unmarshal(data, &reg); err != nil {
		return nil, err
	}
	return &reg, nil
}

func (l *Loader) ResolveRepoPath(sub *models.RepoSubscription) string {
	if sub.LocalPath != "" {
		return filepath.Join(l.Root, sub.LocalPath)
	}
	return filepath.Join(l.Root, "data", "repos", sub.ID)
}
