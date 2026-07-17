package acquisition

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/acme/infragraph/worker/internal/models"
)

type Result struct {
	WorkDir      string `json:"work_dir"`
	ArtifactPath string `json:"artifact_path"`
	FileCount    int    `json:"file_count"`
	Ref          string `json:"ref"`
}

// Stage 2: Source acquisition — copy local repo or use existing path.
func Acquire(sub *models.RepoSubscription, repoRoot, workBase string) (*Result, error) {
	src := repoRoot
	if sub.LocalPath != "" {
		src = filepath.Join(workBase, sub.LocalPath)
	}
	info, err := os.Stat(src)
	if err != nil || !info.IsDir() {
		return nil, fmt.Errorf("repo path not found: %s", src)
	}

	ts := time.Now().UTC().Format("20060102T150405Z")
	dest := filepath.Join(workBase, "data", "artifacts", sub.ID, ts)
	if err := os.MkdirAll(dest, 0o755); err != nil {
		return nil, err
	}

	count, err := copyIaCFiles(src, dest)
	if err != nil {
		return nil, err
	}

	return &Result{
		WorkDir:      dest,
		ArtifactPath: dest,
		FileCount:    count,
		Ref:          "local",
	}, nil
}

func copyIaCFiles(src, dest string) (int, error) {
	count := 0
	err := filepath.Walk(src, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			if info.Name() == ".git" || info.Name() == ".terraform" {
				return filepath.SkipDir
			}
			return nil
		}
		lower := strings.ToLower(path)
		if !strings.HasSuffix(lower, ".tf") && !strings.HasSuffix(lower, ".hcl") &&
			!strings.HasSuffix(lower, "codeowners") && !strings.HasSuffix(lower, ".yaml") {
			return nil
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		target := filepath.Join(dest, rel)
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		if err := copyFile(path, target); err != nil {
			return err
		}
		count++
		return nil
	})
	return count, err
}

func copyFile(src, dest string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dest)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}
