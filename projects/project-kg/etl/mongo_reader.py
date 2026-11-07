"""Read-only access to the SEBI-project MongoDB.

This module NEVER writes to Mongo. It is a new read-only consumer of the
existing collections (tt_complaints, tr_complaints, entity_master,
category_master, subcategory_master), leaving every other service and every
existing collection untouched.
"""
from __future__ import annotations

from typing import Iterator

from pymongo import MongoClient
from pymongo.database import Database

from config.settings import settings

_client: MongoClient | None = None


def get_db() -> Database:
    global _client
    if _client is None:
        _client = MongoClient(settings.mongo_uri, tz_aware=True)
    return _client[settings.mongo_db]


def close() -> None:
    global _client
    if _client is not None:
        _client.close()
        _client = None


def read_categories() -> list[dict]:
    db = get_db()
    return [
        {"code": d.get("category_code"), "name": d.get("category_name")}
        for d in db.category_master.find({}, {"category_code": 1, "category_name": 1})
        if d.get("category_code")
    ]


def read_subcategories() -> list[dict]:
    db = get_db()
    return [
        {"name": d.get("sub_category_name")}
        for d in db.subcategory_master.find({}, {"sub_category_name": 1})
        if d.get("sub_category_name")
    ]


def read_entities() -> list[dict]:
    db = get_db()
    proj = {
        "userid": 1, "name": 1, "registrationnumber": 1, "entitytype": 1,
        "categorycode": 1, "complaint_count": 1, "active_": 1, "isin": 1,
    }
    out: list[dict] = []
    for d in db.entity_master.find({}, proj):
        screenid = d.get("userid")
        if not screenid:
            continue
        out.append({
            "screenid": screenid,
            "name": d.get("name"),
            "registrationnumber": d.get("registrationnumber"),
            "entitytype": d.get("entitytype"),
            "categorycode": d.get("categorycode"),
            "complaint_count": d.get("complaint_count"),
            "active": bool(d.get("active_")) if d.get("active_") is not None else None,
            "isin": d.get("isin"),
        })
    return out


def iter_complaints(limit: int | None = None) -> Iterator[dict]:
    db = get_db()
    proj = {
        "complaintid": 1, "complaint_code": 1, "complaint_category": 1,
        "complaint_sub_category": 1, "complaint_details": 1, "created_date": 1,
        "modified_date": 1, "date_of_closure": 1, "wfstate": 1, "status": 1,
        "currentaction": 1, "entityscreenid": 1, "company_name": 1,
        "complainant_id": 1, "userid": 1,
    }
    cur = db.tt_complaints.find({}, proj)
    if limit:
        cur = cur.limit(limit)
    yield from cur


def iter_tr_events(complaint_ids: set[int] | None = None) -> Iterator[dict]:
    db = get_db()
    proj = {
        "logid": 1, "complaintid": 1, "action": 1, "wfstate": 1, "role": 1,
        "created_date": 1, "remarks": 1, "doc_url": 1, "currentassignerole": 1,
    }
    query: dict = {}
    if complaint_ids is not None:
        query = {"complaintid": {"$in": list(complaint_ids)}}
    yield from db.tr_complaints.find(query, proj)
