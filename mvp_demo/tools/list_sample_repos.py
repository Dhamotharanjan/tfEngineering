from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = ROOT / 'sample_repos'

if __name__ == '__main__':
    for repo_dir in sorted(REPO_ROOT.iterdir()):
        if repo_dir.is_dir():
            print(repo_dir.name)
            for path in sorted(repo_dir.iterdir()):
                print(f'  - {path.name}')
