package acquisition

import (
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/acme/infragraph/worker/internal/models"
)

// AcquireOptions controls git vs local acquisition.
type AcquireOptions struct {
	PreferredSHA string // checkout this SHA when using git
	ForceFull    bool   // skip shallow optimizations
}

// Extended Result with git watermark fields.
func (r *Result) WithGit(sha, ref string) *Result {
	r.HeadSHA = sha
	r.Ref = ref
	r.IsGit = sha != "" && sha != "local"
	return r
}

// AcquireRepo is remote-first: subscribe = scan rights on github_full_name.
// Ephemeral mirrors live under data/mirrors (worker cache only — not product-owned source).
// local_path is offline/demo fallback when IGCS_FORCE_LOCAL=true or no remote URL.
func AcquireRepo(sub *models.RepoSubscription, repoRoot, workBase string, opts *AcquireOptions) (*Result, error) {
	if opts == nil {
		opts = &AcquireOptions{}
	}

	mirrorDir := filepath.Join(workBase, "data", "mirrors", sub.ID)
	cloneURL := resolveCloneURL(sub)
	forceLocal := os.Getenv("IGCS_FORCE_LOCAL") == "true"

	localSrc := repoRoot
	if sub.LocalPath != "" {
		localSrc = filepath.Join(workBase, sub.LocalPath)
	}

	// Remote-first for normal subscribed repos.
	if !forceLocal && cloneURL != "" {
		if !gitAvailable() {
			return nil, fmt.Errorf("stage2 acquisition: git not available for remote clone of %s", safeRepoLabel(sub))
		}
		if err := ensureMirror(mirrorDir, cloneURL); err != nil {
			return nil, fmt.Errorf("stage2 acquisition: remote clone/fetch failed for %s: %w", safeRepoLabel(sub), err)
		}
		sha, err := gitRevParse(mirrorDir, "HEAD")
		if err != nil {
			return nil, err
		}
		if opts.PreferredSHA != "" {
			_ = gitFetch(mirrorDir)
			if err := gitCheckout(mirrorDir, opts.PreferredSHA); err != nil {
				return nil, fmt.Errorf("stage2 acquisition: checkout %s on %s: %w", opts.PreferredSHA, safeRepoLabel(sub), err)
			}
			sha = opts.PreferredSHA
		} else {
			_ = gitFetch(mirrorDir)
			sha, _ = gitRevParse(mirrorDir, "HEAD")
		}
		return materializeFromSource(sub.ID, workBase, mirrorDir, sha, "HEAD")
	}

	// Demo / offline: local_path only when forced or no remote identity.
	if isGitRepo(localSrc) {
		sha, err := gitRevParse(localSrc, "HEAD")
		if err != nil {
			return nil, err
		}
		if opts.PreferredSHA != "" {
			_ = gitCheckout(localSrc, opts.PreferredSHA)
			sha = opts.PreferredSHA
		}
		return materializeFromSource(sub.ID, workBase, localSrc, sha, "HEAD")
	}

	res, err := Acquire(sub, repoRoot, workBase)
	if err != nil {
		if cloneURL == "" && sub.GithubFullName != "" {
			return nil, fmt.Errorf(
				"stage2 acquisition: no remote URL for %s (set GITHUB_TOKEN for private repos) and local_path not found",
				safeRepoLabel(sub),
			)
		}
		if cloneURL == "" {
			return nil, fmt.Errorf("stage2 acquisition: repo path not found for %s (no github_full_name / local_path)", sub.ID)
		}
		return nil, err
	}
	res.SourceDir = localSrc
	res.HeadSHA = ""
	res.IsGit = false
	return res, nil
}

func materializeFromSource(repoID, workBase, sourceDir, sha, ref string) (*Result, error) {
	ts := time.Now().UTC().Format("20060102T150405Z")
	dest := filepath.Join(workBase, "data", "artifacts", repoID, ts)
	if err := os.MkdirAll(dest, 0o755); err != nil {
		return nil, err
	}
	count, err := copyIaCFiles(sourceDir, dest)
	if err != nil {
		return nil, err
	}
	return (&Result{
		WorkDir:      dest,
		ArtifactPath: dest,
		FileCount:    count,
		SourceDir:    sourceDir,
	}).WithGit(sha, ref), nil
}

func safeRepoLabel(sub *models.RepoSubscription) string {
	if sub == nil {
		return "unknown"
	}
	if sub.GithubFullName != "" {
		return sub.GithubFullName
	}
	return sub.ID
}

func resolveCloneURL(sub *models.RepoSubscription) string {
	if sub == nil {
		return ""
	}
	if u := os.Getenv("GIT_CLONE_URL_OVERRIDE"); u != "" {
		return u
	}
	name := strings.TrimSpace(sub.GithubFullName)
	if name == "" {
		return ""
	}
	token := os.Getenv("GITHUB_TOKEN")
	if token == "" {
		token = os.Getenv("GH_TOKEN")
	}
	host := os.Getenv("GITHUB_HOST")
	if host == "" {
		host = "github.com"
	}
	if token != "" {
		return fmt.Sprintf("https://x-access-token:%s@%s/%s.git", token, host, name)
	}
	// Public clone by default (opt out with IGCS_ALLOW_PUBLIC_CLONE=false).
	// Private repos still need a token — clone will fail with a clear error.
	if os.Getenv("IGCS_ALLOW_PUBLIC_CLONE") == "false" {
		return ""
	}
	return fmt.Sprintf("https://%s/%s.git", host, name)
}

// RedactTokenFromURL strips credentials for error messages.
func RedactTokenFromURL(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return raw
	}
	if u.User != nil {
		u.User = url.User("***")
	}
	return u.String()
}

func gitAvailable() bool {
	_, err := exec.LookPath("git")
	return err == nil
}

func isGitRepo(dir string) bool {
	info, err := os.Stat(filepath.Join(dir, ".git"))
	return err == nil && (info.IsDir() || info.Mode().IsRegular())
}

func ensureMirror(dir, cloneURL string) error {
	if isGitRepo(dir) {
		return gitFetch(dir)
	}
	if err := os.MkdirAll(filepath.Dir(dir), 0o755); err != nil {
		return err
	}
	_ = os.RemoveAll(dir + ".git")
	cmd := exec.Command("git", "clone", "--depth", "50", cloneURL, dir)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("git clone %s: %w (%s)", RedactTokenFromURL(cloneURL), err, strings.TrimSpace(string(out)))
	}
	return nil
}

func gitFetch(dir string) error {
	cmd := exec.Command("git", "-C", dir, "fetch", "--all", "--prune")
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("git fetch: %w (%s)", err, strings.TrimSpace(string(out)))
	}
	return nil
}

func gitRevParse(dir, rev string) (string, error) {
	cmd := exec.Command("git", "-C", dir, "rev-parse", rev)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("git rev-parse: %w (%s)", err, strings.TrimSpace(string(out)))
	}
	return strings.TrimSpace(string(out)), nil
}

func gitCheckout(dir, sha string) error {
	cmd := exec.Command("git", "-C", dir, "checkout", "--force", sha)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("git checkout: %w (%s)", err, strings.TrimSpace(string(out)))
	}
	return nil
}

// DiffNames returns changed file paths between two SHAs (name-only).
func DiffNames(sourceDir, fromSHA, toSHA string) ([]string, error) {
	if fromSHA == "" || toSHA == "" || fromSHA == toSHA {
		return nil, nil
	}
	cmd := exec.Command("git", "-C", sourceDir, "diff", "--name-only", fromSHA+".."+toSHA)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("git diff: %w (%s)", err, strings.TrimSpace(string(out)))
	}
	var files []string
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if line != "" {
			files = append(files, filepath.ToSlash(line))
		}
	}
	return files, nil
}
