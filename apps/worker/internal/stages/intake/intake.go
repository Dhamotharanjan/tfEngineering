package intake

import (
	"fmt"

	"github.com/acme/infragraph/worker/internal/config"
	"github.com/acme/infragraph/worker/internal/models"
)

// Stage 1: Subscription gate — only subscribed repos proceed.
func ValidateSubscription(loader *config.Loader, repoID string) (*models.RepoSubscription, error) {
	sub, err := loader.GetSubscription(repoID)
	if err != nil {
		return nil, fmt.Errorf("load subscriptions: %w", err)
	}
	if sub == nil {
		return nil, fmt.Errorf("repo %s is not subscribed", repoID)
	}
	return sub, nil
}

func AllSubscribed(loader *config.Loader) ([]models.RepoSubscription, error) {
	repos, err := loader.LoadSubscriptions()
	if err != nil {
		return nil, err
	}
	var out []models.RepoSubscription
	for _, r := range repos {
		if r.Subscribed {
			out = append(out, r)
		}
	}
	return out, nil
}
