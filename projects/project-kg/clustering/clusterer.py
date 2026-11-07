"""Semantic clustering — Dimension A (scale) and Dimension H (coordination).

Within each RE, complaints are TF-IDF vectorised and linked by cosine similarity
into `SIMILAR_TO` edges; connected components above a size threshold become
root-cause `Cluster` nodes (the consolidated case-files the framework escalates
as one, not N alerts). Near-identical wording (very high cosine) is flagged on
the edge as templated → coordination signal. Separately, a `Product` implicated
by several REs forms a cross-RE product cluster.

Local, no gateway. TF-IDF is a light stand-in for embeddings; the vectoriser can
be swapped for a sentence-transformer without touching the graph logic.
"""
from __future__ import annotations

import logging
from collections import defaultdict

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

from config.defaults import CLUSTERING
from graph.driver import run_query, run_write_batched

logger = logging.getLogger(__name__)


class _UnionFind:
    def __init__(self, n: int) -> None:
        self.p = list(range(n))

    def find(self, x: int) -> int:
        while self.p[x] != x:
            self.p[x] = self.p[self.p[x]]
            x = self.p[x]
        return x

    def union(self, a: int, b: int) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.p[ra] = rb


def _fetch_by_entity() -> dict[str, list[dict]]:
    rows = run_query("""
        MATCH (c:Complaint)-[:FILED_AGAINST]->(e:Entity)
        WHERE c.details IS NOT NULL AND c.details <> ''
        RETURN e.screenid AS entity, c.complaintid AS id,
               c.details AS details, c.state_code AS state
    """)
    by_entity: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        by_entity[r["entity"]].append(r)
    return by_entity


def cluster_entity(items: list[dict]) -> tuple[list[dict], list[dict]]:
    """Return (similarity_edges, clusters) for one RE's complaints."""
    n = len(items)
    if n < CLUSTERING["min_cluster_size"]:
        return [], []

    texts = [str(it["details"]) if it["details"] is not None else "" for it in items]
    vec = TfidfVectorizer(max_features=1500, stop_words="english",
                          ngram_range=(1, 2), min_df=1, max_df=0.9)
    try:
        X = vec.fit_transform(texts)
    except ValueError:
        return [], []  # empty vocabulary (all stop-words / too short)

    sims = cosine_similarity(X)
    tau = CLUSTERING["similarity_threshold"]
    tmpl = CLUSTERING["template_threshold"]
    kmax = CLUSTERING["max_neighbors"]

    uf = _UnionFind(n)
    edges: list[dict] = []
    for i in range(n):
        order = np.argsort(-sims[i])
        cnt = 0
        for j in order:
            if j == i:
                continue
            s = float(sims[i][j])
            if s < tau:
                break
            if i < j:
                edges.append({"a": items[i]["id"], "b": items[j]["id"],
                              "score": round(s, 3), "templated": bool(s >= tmpl)})
            uf.union(i, j)
            cnt += 1
            if cnt >= kmax:
                break

    comps: dict[int, list[int]] = defaultdict(list)
    for i in range(n):
        comps[uf.find(i)].append(i)

    clusters: list[dict] = []
    for members in comps.values():
        if len(members) < CLUSTERING["min_cluster_size"]:
            continue
        member_ids = [items[m]["id"] for m in members]
        states = sorted({items[m]["state"] for m in members if items[m]["state"]})
        templated_frac = _templated_fraction(members, items, sims, tmpl)
        clusters.append({
            "cluster_id": f"rc:{items[members[0]]['id']}",
            "entity": items[members[0]].get("entity"),
            "member_ids": member_ids,
            "size": len(member_ids),
            "n_states": len(states),
            "states": states,
            "templated_frac": templated_frac,
        })
    return edges, clusters


def _templated_fraction(members, items, sims, tmpl) -> float:
    """Share of members whose nearest in-cluster neighbour is near-identical."""
    if len(members) < 2:
        return 0.0
    mset = set(members)
    hits = 0
    for m in members:
        best = max((sims[m][o] for o in mset if o != m), default=0.0)
        if best >= tmpl:
            hits += 1
    return round(hits / len(members), 3)


_SIMILAR_CYPHER = """
UNWIND $rows AS r
MATCH (a:Complaint {complaintid: r.a}), (b:Complaint {complaintid: r.b})
MERGE (a)-[s:SIMILAR_TO]->(b)
SET s.score = r.score, s.templated = r.templated
"""

_CLUSTER_CYPHER = """
UNWIND $rows AS r
MATCH (e:Entity {screenid: r.entity})
MERGE (cl:Cluster {cluster_id: r.cluster_id})
SET cl.kind = 'root_cause', cl.entity_screenid = r.entity, cl.size = r.size,
    cl.n_states = r.n_states, cl.states = r.states, cl.templated_frac = r.templated_frac
MERGE (cl)-[:AGAINST]->(e)
WITH cl, r
UNWIND r.member_ids AS mid
MATCH (c:Complaint {complaintid: mid})
MERGE (c)-[:MEMBER_OF]->(cl)
"""

_WINDOW_CYPHER = """
MATCH (cl:Cluster {kind:'root_cause'})<-[:MEMBER_OF]-(c:Complaint)
WITH cl, min(c.created_date) AS mn, max(c.created_date) AS mx
SET cl.created_min = mn, cl.created_max = mx
"""

_CROSS_RE_CYPHER = """
MATCH (p:Product)<-[:IMPLICATES]-(c:Complaint)-[:FILED_AGAINST]->(e:Entity)
WITH p, count(DISTINCT e) AS n_re, count(DISTINCT c) AS sz, collect(DISTINCT e.screenid) AS entities
WHERE n_re >= $min_re
MERGE (cl:Cluster {cluster_id: 'xre:' + p.key})
SET cl.kind = 'cross_re_product', cl.product_key = p.key,
    cl.n_entities = n_re, cl.size = sz, cl.entities = entities
MERGE (cl)-[:ON_PRODUCT]->(p)
WITH cl, p
MATCH (p)<-[:IMPLICATES]-(c:Complaint)
MERGE (c)-[:MEMBER_OF]->(cl)
"""


def build_all() -> dict:
    """Full clustering pass over the graph. Idempotent (MERGE-based)."""
    by_entity = _fetch_by_entity()
    min_n = CLUSTERING["min_entity_complaints"]

    all_edges: list[dict] = []
    all_clusters: list[dict] = []
    for entity, items in by_entity.items():
        if len(items) < min_n:
            continue
        for it in items:
            it["entity"] = entity
        edges, clusters = cluster_entity(items)
        all_edges.extend(edges)
        all_clusters.extend(clusters)

    logger.info("writing %d SIMILAR_TO edges ...", len(all_edges))
    run_write_batched(_SIMILAR_CYPHER, all_edges, batch_size=2000)
    logger.info("writing %d root-cause clusters ...", len(all_clusters))
    run_write_batched(_CLUSTER_CYPHER, all_clusters, batch_size=500)
    run_query(_WINDOW_CYPHER)

    logger.info("building cross-RE product clusters ...")
    run_query(_CROSS_RE_CYPHER, min_re=CLUSTERING["cross_re_min_entities"])

    return {
        "similarity_edges": len(all_edges),
        "root_cause_clusters": len(all_clusters),
        "entities_clustered": sum(1 for v in by_entity.values() if len(v) >= min_n),
    }
