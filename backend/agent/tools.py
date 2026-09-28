"""
Function-calling tool definitions the Groq model can choose to call, plus
their Python implementations. Kept separate from main.py so the agent loop
(groq_client.run_with_tools) can be unit tested without spinning up FastAPI.
"""
from . import staleness

TOOL_SCHEMAS = [
    {
        "type": "function",
        "function": {
            "name": "recall_codebase",
            "description": (
                "Search Hindsight's memory for facts, observations, or mental "
                "models relevant to a question about the legacy codebase. "
                "Use this before answering any question about what code does."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "What to search for"},
                    "entities": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Optional: specific class/method names to narrow the search",
                    },
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_entity_confidence",
            "description": (
                "Look up whether our understanding of a specific class or method "
                "is CONFIRMED (human-validated, code unchanged since), INFERRED "
                "(never validated by a human), or STALE (was validated, but the "
                "code has changed since). Always call this before presenting an "
                "answer as fact -- never claim something is confirmed without checking."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "entity": {"type": "string", "description": "Class or method name"},
                },
                "required": ["entity"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "record_validation",
            "description": (
                "Record that a human (developer or BA) confirmed or corrected an "
                "explanation of a code entity. Call this whenever a user's message "
                "validates or corrects a previous explanation."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "entity": {"type": "string"},
                    "correction": {
                        "type": "string",
                        "description": "The confirmed or corrected explanation, in full",
                    },
                    "validated_by": {"type": "string", "description": "Name of the person confirming"},
                },
                "required": ["entity", "correction", "validated_by"],
            },
        },
    },
]

# Keys we never want to ship back into the LLM's context -- embeddings,
# vectors, or any other bulky/irrelevant fields Hindsight's raw API response
# might include alongside the actual memory text. This is what was blowing
# past Groq's 8000 TPM limit: recall_codebase used to return Hindsight's
# response completely unfiltered.
_DROP_KEYS = {"embedding", "embeddings", "vector", "vectors"}
_MAX_CONTENT_CHARS = 500  # truncate any single memory's text so one huge
                          # retained explanation can't dominate the budget


def _slim_memory(item: dict) -> dict:
    """Keep only what the model actually needs to answer: the text content
    and which entities it's tagged with. Drop everything else Hindsight's
    API might attach (scores, embeddings, raw timestamps, internal ids)."""
    if not isinstance(item, dict):
        return item
    content = item.get("content") or item.get("text") or ""
    if isinstance(content, str) and len(content) > _MAX_CONTENT_CHARS:
        content = content[:_MAX_CONTENT_CHARS] + "... [truncated]"
    entities = item.get("entities")
    slim = {"content": content}
    if entities:
        # entities may come back as [{"text": "ApplyLateFee"}, ...] or ["ApplyLateFee"]
        slim["entities"] = [
            e.get("text") if isinstance(e, dict) else e for e in entities
        ]
    return slim


def _slim_recall_result(result: dict, max_items: int = 3) -> dict:
    """Strip Hindsight's raw recall response down to plain text before it
    goes anywhere near the LLM's context window."""
    if not isinstance(result, dict):
        return {"memories": []}

    # Hindsight's recall response shape may vary; check the likely keys.
    items = result.get("memories") or result.get("items") or result.get("results") or []
    slim_items = [_slim_memory(i) for i in items[:max_items] if isinstance(i, dict)]
    return {"memories": slim_items}


def make_tool_impls(hindsight_client):
    """Bind tool implementations to a live HindsightClient instance."""

    def recall_codebase(query: str, entities: list[str] = None) -> dict:
        result = hindsight_client.recall(query=query, entities=entities, top_k=3)
        return _slim_recall_result(result)

    def get_entity_confidence(entity: str) -> dict:
        s = staleness.status(entity)
        return {
            "entity": s.entity,
            "badge": s.badge,
            "last_validated_at": s.last_validated_at,
            "validated_by": s.validated_by,
            "last_code_changed_at": s.last_code_changed_at,
        }

    def record_validation(entity: str, correction: str, validated_by: str) -> dict:
        hindsight_client.retain(
            content=correction,
            entities=[entity],
            kind="world",
            metadata={"validated_by": validated_by, "type": "human_validation"},
        )
        staleness.mark_validated(entity, validated_by)
        return {"status": "recorded", "entity": entity, "badge": "CONFIRMED"}

    return {
        "recall_codebase": recall_codebase,
        "get_entity_confidence": get_entity_confidence,
        "record_validation": record_validation,
    }