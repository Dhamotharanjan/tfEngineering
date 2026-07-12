from fastapi import FastAPI

app = FastAPI(title="TF Engineering Intelligence API")

@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "api"}

@app.get("/graph/summary")
def graph_summary() -> dict:
    return {"message": "Graph summary endpoint will connect to Neo4j."}
