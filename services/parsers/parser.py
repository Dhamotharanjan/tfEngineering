import os
import json
import time
from pathlib import Path

import hcl2
import psycopg2
from neo4j import GraphDatabase

NEO4J_URI = os.environ.get("NEO4J_URI", "bolt://neo4j:7687")
NEO4J_USER = os.environ.get("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.environ.get("NEO4J_PASSWORD", "neo4j123")
POSTGRES_DSN = os.environ.get("POSTGRES_DSN", "postgresql://tfengineering:tfengineering123@postgres:5432/tfengineering")

SAMPLES_DIR = Path("./samples")


def parse_terraform_file(path: Path):
    with open(path, "r") as f:
        obj = hcl2.load(f)
    resources = []
    res_section = obj.get("resource", {})
    # resource block can be dict or list depending on parser
    if isinstance(res_section, dict):
        for res_type, res_block in res_section.items():
            if isinstance(res_block, dict):
                for name, attrs in res_block.items():
                    resources.append({"type": res_type, "name": name, "attributes": attrs})
            elif isinstance(res_block, list):
                for item in res_block:
                    for name, attrs in item.items():
                        resources.append({"type": res_type, "name": name, "attributes": attrs})
    elif isinstance(res_section, list):
        for entry in res_section:
            if isinstance(entry, dict):
                for res_type, res_block in entry.items():
                    for name, attrs in res_block.items():
                        resources.append({"type": res_type, "name": name, "attributes": attrs})
    return resources


def write_to_postgres(conn, repo_name, repo_path):
    with conn.cursor() as cur:
        cur.execute("CREATE TABLE IF NOT EXISTS repositories (id SERIAL PRIMARY KEY, name TEXT, path TEXT, created_at TIMESTAMP DEFAULT now())")
        cur.execute("INSERT INTO repositories (name, path) VALUES (%s, %s) RETURNING id", (repo_name, str(repo_path)))
        repo_id = cur.fetchone()[0]
        conn.commit()
    return repo_id


def write_to_neo4j(driver, repo_name, repo_path, resources):
    with driver.session() as session:
        session.run(
            "MERGE (r:Repository {name:$name}) SET r.path=$path RETURN r",
            name=repo_name,
            path=str(repo_path),
        )
        for res in resources:
            session.run(
                "MERGE (res:Resource {type:$type, name:$name}) SET res.attributes=$attrs WITH res MATCH (r:Repository {name:$repo}) MERGE (r)-[:HAS_RESOURCE]->(res)",
                type=res["type"],
                name=res["name"],
                attrs=json.dumps(res["attributes"]),
                repo=repo_name,
            )


def main():
    print("Parser starting, connecting to services...")
    # Connect Postgres
    pg = psycopg2.connect(POSTGRES_DSN)
    print("Connected to Postgres")
    # Connect Neo4j
    driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))
    print("Connected to Neo4j")

    # discover sample repos
    for sample in SAMPLES_DIR.glob("**/*.tf"):
        repo_name = sample.parent.name or "sample-repo"
        print(f"Parsing {sample}")
        try:
            resources = parse_terraform_file(sample)
            repo_id = write_to_postgres(pg, repo_name, sample.parent)
            write_to_neo4j(driver, repo_name, sample.parent, resources)
            print(f"Inserted repo {repo_name} (id={repo_id}) with {len(resources)} resources")
        except Exception as e:
            print("Error parsing or writing:", e)

    driver.close()
    pg.close()
    print("Parser finished")


if __name__ == "__main__":
    main()
