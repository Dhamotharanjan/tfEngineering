import sys
from pathlib import Path
import json

sys.path.append(str(Path(__file__).resolve().parents[1]))
from parser import parse_terraform_file

BASE = Path('./samples')

def run():
    print('Running parser tests against samples...')
    totals = {}
    for tf in Path('./samples').rglob('*.tf'):
        resources = parse_terraform_file(tf)
        print(f'{tf}: {len(resources)} resources')
        totals[str(tf)] = len(resources)

    # also test extra test_data
    for tf in Path('./test_data').rglob('*.tf'):
        resources = parse_terraform_file(tf)
        print(f'{tf}: {len(resources)} resources')
        totals[str(tf)] = len(resources)

    print('\nSummary:')
    for k, v in totals.items():
        print(f'- {k}: {v}')

if __name__ == '__main__':
    run()
