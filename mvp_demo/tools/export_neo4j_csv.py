#!/usr/bin/env python3
"""
Produce CSV files suitable for Neo4j bulk import:
- nodes.csv with header :ID,name,change_pending
- rels.csv with header :START_ID,:END_ID,:TYPE
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

    nodes_csv = OUT / 'neo4j_nodes.csv'
    rels_csv = OUT / 'neo4j_rels.csv'

    with nodes_csv.open('w', encoding='utf-8') as f:
        f.write(':ID,name,change_pending\n')
        for n in nodes:
            f.write(f"{n['id']},{n.get('label','')},{str(n.get('change_pending',False)).lower()}\n")

    with rels_csv.open('w', encoding='utf-8') as f:
        f.write(':START_ID,:END_ID,:TYPE\n')
        for e in edges:
            f.write(f"{e['from']},{e['to']},DEPENDS_ON\n")

    print('Neo4j CSVs written to', OUT)

if __name__ == '__main__':
    main()
