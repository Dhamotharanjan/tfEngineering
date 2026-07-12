import os
import json
import zipfile
import uuid
from pathlib import Path
import redis

REDIS_URL = os.environ.get('REDIS_URL', 'redis://redis:6379/0')
SAMPLE_PATH = Path(__file__).resolve().parents[1] / 'sample_repo'
ZIP_PATH = Path.cwd() / 'sample_repo.zip'

def zip_repo(src: Path, dest: Path):
    with zipfile.ZipFile(dest, 'w', zipfile.ZIP_DEFLATED) as z:
        for f in src.rglob('*'):
            z.write(f, f.relative_to(src))

def main():
    job_id = str(uuid.uuid4())
    print('Zipping sample repo...')
    zip_repo(SAMPLE_PATH, ZIP_PATH)
    print(f'Created {ZIP_PATH}')

    # push job to redis list
    r = redis.from_url(REDIS_URL)
    job = {
        'id': job_id,
        'source': 'local-zip',
        'zip_path': str(ZIP_PATH),
        'repo_name': 'sample_repo',
    }
    r.lpush('repo_scan_queue', json.dumps(job))
    print(f'Enqueued job {job_id} to repo_scan_queue')

if __name__ == '__main__':
    main()
