"""Neo4j driver singleton + batched write / read helpers.

The graph is the store of record for the knowledge graph and the computed
Systemic-Criticality Scores. Nothing here writes back to MongoDB.
"""
from __future__ import annotations

import logging
from typing import Any, Sequence

from neo4j import Driver, GraphDatabase

from config.settings import settings

logger = logging.getLogger(__name__)

_driver: Driver | None = None


def get_driver() -> Driver:
    global _driver
    if _driver is None:
        _driver = GraphDatabase.driver(
            settings.neo4j_uri,
            auth=(settings.neo4j_user, settings.neo4j_password),
        )
    return _driver


def close_driver() -> None:
    global _driver
    if _driver is not None:
        _driver.close()
        _driver = None


def run_statements(statements: Sequence[str]) -> None:
    """Run a sequence of parameter-less Cypher statements (DDL / maintenance)."""
    driver = get_driver()
    with driver.session() as session:
        for stmt in statements:
            session.run(stmt).consume()


def run_write_batched(cypher: str, rows: list[dict], batch_size: int = 1000) -> int:
    """Execute `cypher` (which references `$rows`) over `rows` in batches.

    Returns the number of rows processed.
    """
    driver = get_driver()
    total = 0
    with driver.session() as session:
        for i in range(0, len(rows), batch_size):
            chunk = rows[i : i + batch_size]
            session.execute_write(
                lambda tx, c=chunk: tx.run(cypher, rows=c).consume()
            )
            total += len(chunk)
    return total


def run_write_multi(statements: Sequence[str], rows: list[dict], batch_size: int = 1000) -> int:
    """Run several `$rows`-parameterised statements per batch inside one tx.

    Used when node creation and its relationships must be committed together per
    batch (e.g. complaints + FILED_AGAINST / IN_CATEGORY / ... in one pass).
    """
    driver = get_driver()
    total = 0
    with driver.session() as session:
        for i in range(0, len(rows), batch_size):
            chunk = rows[i : i + batch_size]

            def _work(tx, c=chunk):
                for stmt in statements:
                    tx.run(stmt, rows=c).consume()

            session.execute_write(_work)
            total += len(chunk)
    return total


def run_query(cypher: str, **params: Any) -> list[dict]:
    driver = get_driver()
    with driver.session() as session:
        return [r.data() for r in session.run(cypher, **params)]


def graph_healthcheck() -> dict[str, object]:
    try:
        driver = get_driver()
        driver.verify_connectivity()
        with driver.session() as session:
            nodes = session.run("MATCH (n) RETURN count(n) AS c").single()["c"]
            rels = session.run("MATCH ()-[r]->() RETURN count(r) AS c").single()["c"]
            labels = session.run(
                "CALL db.labels() YIELD label RETURN collect(label) AS labels"
            ).single()["labels"]
        return {
            "status": "ok",
            "neo4j": "connected",
            "nodes": nodes,
            "relationships": rels,
            "labels": sorted(labels),
        }
    except Exception as e:  # noqa: BLE001 — healthcheck must never raise
        return {"status": "error", "neo4j": "unreachable", "detail": str(e)}
