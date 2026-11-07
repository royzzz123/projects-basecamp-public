"""LangChain tools for querying the SEBI-project MongoDB database directly."""
import json
from typing import Any

from langchain_core.tools import tool
from motor.motor_asyncio import AsyncIOMotorDatabase


def make_tools(db: AsyncIOMotorDatabase):
    """Return tool functions bound to the given Motor database."""

    @tool
    async def find_entity(name: str) -> str:
        """Search for an entity (broker, mutual fund, etc.) by name in entity_master.
        Returns userid (entity code), full name, and pre-computed complaint_count.
        Use this first when a user asks about complaints for a specific company."""
        cursor = db["entity_master"].find(
            {"name": {"$regex": name, "$options": "i"}},
            {"_id": 0, "userid": 1, "name": 1, "complaint_count": 1, "entitytype": 1},
            limit=10,
        )
        results = await cursor.to_list(length=10)
        if not results:
            return f"No entity found matching '{name}'."
        return json.dumps(results, default=str)

    @tool
    async def count_complaints(filter_json: str) -> str:
        """Count complaints in tt_complaints matching a MongoDB filter.
        filter_json must be a valid JSON object string, e.g. '{"company_name": "i00470"}'.
        Use this to get precise counts with filters like status, category, date ranges."""
        try:
            filt: dict[str, Any] = json.loads(filter_json) if filter_json.strip() else {}
        except json.JSONDecodeError as e:
            return f"Invalid filter JSON: {e}"
        count = await db["tt_complaints"].count_documents(filt)
        return str(count)

    @tool
    async def aggregate_complaints(pipeline_json: str) -> str:
        """Run a MongoDB aggregation pipeline on tt_complaints.
        pipeline_json must be a JSON array of pipeline stage objects.
        Use for grouping, top-N ranking, date histograms, etc.
        Results are capped at 20 documents.
        Example: '[{"$group":{"_id":"$complaint_category","count":{"$sum":1}}},{"$sort":{"count":-1}},{"$limit":5}]'"""
        try:
            pipeline: list[Any] = json.loads(pipeline_json)
        except json.JSONDecodeError as e:
            return f"Invalid pipeline JSON: {e}"
        # Safety cap
        has_limit = any("$limit" in stage for stage in pipeline)
        if not has_limit:
            pipeline.append({"$limit": 20})
        cursor = db["tt_complaints"].aggregate(pipeline)
        results = await cursor.to_list(length=20)
        if not results:
            return "No results."
        return json.dumps(results, default=str)

    @tool
    async def get_categories() -> str:
        """Return all complaint category codes and their human-readable names from category_master.
        Use this to map category codes (like 'cat8') to names, or to find the code for a given category name."""
        cursor = db["category_master"].find({}, {"_id": 0, "code": 1, "name": 1})
        results = await cursor.to_list(length=50)
        return json.dumps(results, default=str)

    return [find_entity, count_complaints, aggregate_complaints, get_categories]
