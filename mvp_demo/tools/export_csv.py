#!/usr/bin/env python3
"""
Export sample_data.json to CSVs: nodes.csv and edges.csv
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'sample_data.json'
OUT = ROOT / 'exports'
OUT.mkdir(exist_ok=True)

def main():
    j = json.loads(DATA.read_text(encoding='utf-8'))
    nodes = j.get('nodes', [])
    edges = j.get('edges', [])

    nodes_csv = OUT / 'nodes.csv'
    edges_csv = OUT / 'edges.csv'

    with nodes_csv.open('w', encoding='utf-8') as f:
        f.write('id,label,change_pending\n')
        for n in nodes:
            f.write(f"{n['id']},{n.get('label','')},{str(n.get('change_pending',False))}\n")

    with edges_csv.open('w', encoding='utf-8') as f:
        f.write('from,to\n')
        for e in edges:
            f.write(f"{e['from']},{e['to']}\n")

    print('Exported:', nodes_csv, edges_csv)

if __name__ == '__main__':
    main()
