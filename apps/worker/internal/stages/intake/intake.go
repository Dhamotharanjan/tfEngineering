package intake

import (
	"context"
	"fmt"

	"github.com/acme/infragraph/worker/internal/config"
	"github.com/acme/infragraph/worker/internal/models"
	"github.com/acme/infragraph/worker/internal/store"
)

// Stage 1: Subscription gate — only subscribed repos proceed.
// Postgres is source of truth (UI toggles); config fills local_path / profile when missing.
func ValidateSubscription(ctx context.Context, loader *config.Loader, pg *store.Postgres, repoID string) (*models.RepoSubscription, error) {
	if pg != nil {
		sub, err := pg.GetSubscribedRepo(ctx, repoID)
		if err != nil {
			return nil, fmt.Errorf("load subscription from db: %w", err)
		}
		if sub != nil {
			enrichFromConfig(loader, sub)
			return sub, nil
		}
	}

	// Fallback: config file (startup / no DB row yet)
	sub, err := loader.GetSubscription(repoID)
	if err != nil {
		return nil, fmt.Errorf("load subscriptions: %w", err)
	}
	if sub == nil {
		return nil, fmt.Errorf("repo %s is not subscribed", repoID)
	}
	return sub, nil
}

func enrichFromConfig(loader *config.Loader, sub *models.RepoSubscription) {
	cfg, err := loader.LoadSubscriptions()
	if err != nil {
		return
	}
	for _, c := range cfg {
		if c.ID != sub.ID {
			continue
		}
		if sub.LocalPath == "" && c.LocalPath != "" {
			sub.LocalPath = c.LocalPath
		}
		if sub.ScanProfile == "" && c.ScanProfile != "" {
			sub.ScanProfile = c.ScanProfile
		}
		if len(sub.ModuleSourcesWatched) == 0 && len(c.ModuleSourcesWatched) > 0 {
			sub.ModuleSourcesWatched = c.ModuleSourcesWatched
		}
		if len(sub.ComplianceScope) == 0 && len(c.ComplianceScope) > 0 {
			sub.ComplianceScope = c.ComplianceScope
		}
		break
	}
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
