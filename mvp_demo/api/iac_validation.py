import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SAMPLE_REPO_ROOT = ROOT / 'sample_repos'


def _run_command(command, cwd):
    try:
        completed = subprocess.run(
            command,
            cwd=str(cwd),
            capture_output=True,
            text=True,
            timeout=90,
            check=False,
        )
        return {
            'command': ' '.join(command),
            'status': 'passed' if completed.returncode == 0 else 'failed',
            'exit_code': completed.returncode,
            'stdout': (completed.stdout or '').strip(),
            'stderr': (completed.stderr or '').strip(),
        }
    except subprocess.TimeoutExpired:
        return {
            'command': ' '.join(command),
            'status': 'timeout',
            'exit_code': None,
            'stdout': '',
            'stderr': 'Command timed out after 90 seconds',
        }
    except Exception as exc:
        return {
            'command': ' '.join(command),
            'status': 'error',
            'exit_code': None,
            'stdout': '',
            'stderr': str(exc),
        }


def _resolve_repo_path(repo_id):
    sample_path = SAMPLE_REPO_ROOT / repo_id
    if sample_path.exists():
        return sample_path
    return None


def validate_repo_iac(repo_id):
    repo_path = _resolve_repo_path(repo_id)
    if repo_path is None:
        return {
            'repo': repo_id,
            'status': 'skipped',
            'message': 'No local repo path found for validation',
            'results': [],
        }

    results = []

    terraform = shutil.which('terraform')
    terragrunt = shutil.which('terragrunt')

    if terraform:
        results.append(_run_command([terraform, 'version'], repo_path))
        if any(repo_path.glob('*.tf')):
            results.append(_run_command([terraform, 'validate', '-no-color'], repo_path))
    else:
        results.append({
            'command': 'terraform version',
            'status': 'skipped',
            'exit_code': None,
            'stdout': '',
            'stderr': 'terraform binary not found in runtime image',
        })

    if terragrunt:
        results.append(_run_command([terragrunt, '--version'], repo_path))
        if (repo_path / 'terragrunt.hcl').exists():
            results.append(_run_command([terragrunt, 'validate-inputs', '--terragrunt-non-interactive'], repo_path))
    else:
        results.append({
            'command': 'terragrunt --version',
            'status': 'skipped',
            'exit_code': None,
            'stdout': '',
            'stderr': 'terragrunt binary not found in runtime image',
        })

    failed = [entry for entry in results if entry.get('status') in {'failed', 'timeout', 'error'}]
    overall = 'failed' if failed else 'passed'
    return {
        'repo': repo_id,
        'status': overall,
        'message': 'Terraform/Terragrunt validation completed',
        'results': results,
    }
