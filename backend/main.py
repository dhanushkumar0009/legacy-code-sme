import os
import re
import logging
from typing import Any

from dotenv import load_dotenv

# Load .env from project root
load_dotenv(
    os.path.join(
        os.path.dirname(__file__),
        "..",
        ".env",
    )
)

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from agent.hindsight_client import HindsightClient
from agent.groq_client import GroqAgentClient
from agent.tools import TOOL_SCHEMAS, make_tool_impls
from agent.prompts import SYSTEM_PROMPT
from agent import staleness


# ============================================================
# LOGGING
# ============================================================

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)

logger = logging.getLogger("legacy-code-sme")


# ============================================================
# APPLICATION
# ============================================================

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.abspath(os.path.join(BASE_DIR, ".."))
FRONTEND_DIR = os.path.join(PROJECT_DIR, "frontend")
DATA_DIR = os.path.join(BASE_DIR, "data")

app = FastAPI(
    title="Legacy Code SME",
    description="AI assistant for understanding and maintaining legacy code.",
    version="1.0.0",
)


# ============================================================
# CORS
# ============================================================

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================
# CLIENTS
# ============================================================

hindsight = HindsightClient()
groq = GroqAgentClient()

tool_impls = make_tool_impls(hindsight)


# ============================================================
# REQUEST / RESPONSE MODELS
# ============================================================

class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=10000)

    user_name: str = Field(
        default="unknown reviewer",
        max_length=100,
    )

    history: list[ChatMessage] = Field(
        default_factory=list
    )


class ChatResponse(BaseModel):
    reply: str
    status: str = "success"


class ReingestRequest(BaseModel):
    entity: str = Field(..., min_length=1, max_length=200)
    new_explanation: str = Field(..., min_length=1, max_length=20000)


# ============================================================
# RESPONSE CLEANUP
# ============================================================

def clean_agent_response(reply: Any) -> str:
    """
    Convert the agent's output into clean text suitable for the UI.

    The agent may occasionally return a Python object, JSON-like
    structure, or an internal error message. This function keeps
    the frontend from displaying raw internal structures.
    """

    if reply is None:
        return "I couldn't generate an answer."

    # Some clients return an object with a content attribute.
    if hasattr(reply, "content"):
        reply = reply.content

    if not isinstance(reply, str):
        reply = str(reply)

    reply = reply.strip()

    if not reply:
        return "I couldn't generate an answer."

    # --------------------------------------------------------
    # Hide accidental internal reasoning-style output
    # --------------------------------------------------------

    internal_prefixes = (
        "I ran out of reasoning steps",
        "I ran out of reasoning",
        "Groq call failed after retries",
        "Error code:",
        "Traceback",
    )

    for prefix in internal_prefixes:
        if reply.startswith(prefix):
            logger.warning(
                "Internal-looking agent response detected: %s",
                reply[:200],
            )

            return (
                "I couldn't complete that request right now. "
                "Please try the question again."
            )

    # --------------------------------------------------------
    # Remove accidental wrapping quotes
    # --------------------------------------------------------

    if (
        len(reply) >= 2
        and reply[0] == '"'
        and reply[-1] == '"'
    ):
        reply = reply[1:-1].strip()

    return reply


# ============================================================
# ERROR MESSAGE HELPERS
# ============================================================

def friendly_error_message(error: Exception) -> str:
    """
    Convert common provider errors into user-friendly messages.
    """

    error_text = str(error).lower()

    # Groq / model rate limit
    if (
        "429" in error_text
        or "rate limit" in error_text
        or "rate_limit_exceeded" in error_text
        or "tokens per minute" in error_text
    ):
        return (
            "The language model is temporarily rate-limited. "
            "Please wait a few seconds and try again."
        )

    # Timeout
    if (
        "timeout" in error_text
        or "timed out" in error_text
    ):
        return (
            "The request took too long to complete. "
            "Please try again."
        )

    # Connection
    if (
        "connection" in error_text
        or "connect" in error_text
    ):
        return (
            "I couldn't connect to one of the AI services. "
            "Please try again in a moment."
        )

    # Generic
    return (
        "I couldn't complete that request right now. "
        "Please try again."
    )


# ============================================================
# HEALTH CHECK
# ============================================================

@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "legacy-code-sme",
    }


# ============================================================
# CHAT
# ============================================================

@app.post(
    "/chat",
    response_model=ChatResponse,
)
def chat(req: ChatRequest):

    logger.info(
        "Chat request from user=%s message=%s",
        req.user_name,
        req.message[:100],
    )

    # --------------------------------------------------------
    # Build conversation
    # --------------------------------------------------------

    messages = [
        {
            "role": "system",
            "content": SYSTEM_PROMPT,
        }
    ]

    # --------------------------------------------------------
    # Validate history
    # --------------------------------------------------------

    for item in req.history:

        role = item.role.strip().lower()

        if role not in {"user", "assistant"}:
            continue

        content = item.content.strip()

        if not content:
            continue

        messages.append(
            {
                "role": role,
                "content": content,
            }
        )

    # --------------------------------------------------------
    # Current user message
    # --------------------------------------------------------

    messages.append(
        {
            "role": "user",
            "content": (
                f"[speaking as: {req.user_name}] "
                f"{req.message.strip()}"
            ),
        }
    )

    # --------------------------------------------------------
    # Run agent
    # --------------------------------------------------------

    try:

        raw_reply = groq.run_with_tools(
            messages,
            TOOL_SCHEMAS,
            tool_impls,
        )

        reply = clean_agent_response(raw_reply)

        logger.info(
            "Chat response generated successfully."
        )

        return ChatResponse(
            reply=reply,
            status="success",
        )

    except Exception as e:

        logger.exception(
            "Chat request failed."
        )

        message = friendly_error_message(e)

        # Do not expose provider internals to frontend.
        return ChatResponse(
            reply=message,
            status="error",
        )


# ============================================================
# MEMORY PANEL
# ============================================================

@app.get("/memories")
def memories():
    """
    Powers the 'What the agent remembers' panel.
    """

    try:

        entities = staleness.all_entities()

        return {
            "entities": [
                {
                    "entity": e.entity,
                    "badge": e.badge,
                    "last_validated_at": e.last_validated_at,
                    "validated_by": e.validated_by,
                    "last_code_changed_at": e.last_code_changed_at,
                }
                for e in entities
            ]
        }

    except Exception:

        logger.exception(
            "Failed to load memories."
        )

        return {
            "entities": []
        }


# ============================================================
# SIMULATE CODE CHANGE
# ============================================================

@app.post("/simulate-code-change")
def simulate_code_change(
    req: ReingestRequest,
):

    logger.info(
        "Re-ingesting entity=%s",
        req.entity,
    )

    try:

        hindsight.retain(
            content=req.new_explanation,
            entities=[req.entity],
            kind="world",
            metadata={
                "type": "code_change_reingest",
            },
        )

        staleness.mark_code_seen(
            req.entity,
            req.new_explanation,
        )

        status = staleness.status(
            req.entity
        )

        return {
            "status": "reingested",
            "entity": req.entity,
            "badge": status.badge,
        }

    except Exception as e:

        logger.exception(
            "Failed to re-ingest entity=%s",
            req.entity,
        )

        raise HTTPException(
            status_code=500,
            detail=friendly_error_message(e),
        )


# ============================================================
# LEGACY CODE PARSING
# ============================================================

METHOD_PATTERN = re.compile(
    r"""
    (?:
        public
        |private
        |protected
        |internal
    )
    \s+
    [\w<>\[\],\s]+
    \s+
    (\w+)
    \s*
    \([^)]*\)
    \s*
    \{
    """,
    re.MULTILINE | re.VERBOSE,
)

CLASS_PATTERN = re.compile(
    r"\bclass\s+(\w+)"
)


def _extract_methods(source: str) -> list[dict]:

    methods = []

    for match in METHOD_PATTERN.finditer(source):

        name = match.group(1)

        start = match.end() - 1

        depth = 0
        end = start

        for i in range(
            start,
            len(source),
        ):

            char = source[i]

            if char == "{":
                depth += 1

            elif char == "}":

                depth -= 1

                if depth == 0:

                    end = i + 1
                    break

        body = source[
            match.start():end
        ]

        methods.append(
            {
                "name": name,
                "body": body,
            }
        )

    return methods


# ============================================================
# ADMIN INGESTION
# ============================================================

@app.get("/admin/ingest")
def admin_ingest(
    dir_name: str = "sample_legacy_repo",
):

    path = os.path.join(
        DATA_DIR,
        dir_name,
    )

    # --------------------------------------------------------
    # Security: don't allow directory traversal
    # --------------------------------------------------------

    requested_path = os.path.abspath(path)

    allowed_root = os.path.abspath(DATA_DIR)

    if not requested_path.startswith(
        allowed_root + os.sep
    ):
        raise HTTPException(
            status_code=400,
            detail="Invalid data directory.",
        )

    if not os.path.isdir(
        requested_path
    ):
        raise HTTPException(
            status_code=404,
            detail=(
                f"No such data directory: "
                f"{requested_path}"
            ),
        )

    ingested = []
    failed = []

    logger.info(
        "Starting ingestion from %s",
        requested_path,
    )

    # --------------------------------------------------------
    # Process source files
    # --------------------------------------------------------

    for filename in os.listdir(
        requested_path
    ):

        if not filename.endswith(
            (".cs", ".java")
        ):
            continue

        file_path = os.path.join(
            requested_path,
            filename,
        )

        try:

            with open(
                file_path,
                "r",
                encoding="utf-8",
            ) as file:

                source = file.read()

            class_match = CLASS_PATTERN.search(
                source
            )

            class_name = (
                class_match.group(1)
                if class_match
                else filename
            )

            methods = _extract_methods(
                source
            )

            logger.info(
                "Found %d methods in %s",
                len(methods),
                filename,
            )

            for method in methods:

                prompt = (
                    "You are reverse-engineering "
                    "an undocumented legacy "
                    f"C#/Java class called "
                    f"{class_name}. "
                    "Read this method and write "
                    "a short, plain-English "
                    "explanation (2-4 sentences) "
                    "of what business logic it "
                    "implements. "
                    "Be specific about conditions "
                    "and edge cases visible in "
                    "the code. "
                    "Do not guess at anything "
                    "not visible in the code.\n\n"
                    "```text\n"
                    f"{method['body']}\n"
                    "```"
                )

                try:

                    explanation_response = groq.chat(
                        [
                            {
                                "role": "user",
                                "content": prompt,
                            }
                        ]
                    )

                    if hasattr(
                        explanation_response,
                        "content",
                    ):
                        explanation = (
                            explanation_response
                            .content
                            .strip()
                        )
                    else:
                        explanation = str(
                            explanation_response
                        ).strip()

                    if not explanation:
                        raise ValueError(
                            "Empty explanation returned."
                        )

                    # ------------------------------------------------
                    # Store explanation in Hindsight
                    # ------------------------------------------------

                    hindsight.retain(
                        content=(
                            f"{class_name}."
                            f"{method['name']}: "
                            f"{explanation}"
                        ),
                        entities=[
                            method["name"],
                            class_name,
                        ],
                        kind="world",
                        metadata={
                            "type": (
                                "code_derived_inference"
                            ),
                            "file": filename,
                        },
                    )

                    # ------------------------------------------------
                    # Update staleness information
                    # ------------------------------------------------

                    staleness.mark_code_seen(
                        method["name"],
                        explanation,
                    )

                    ingested.append(
                        f"{class_name}."
                        f"{method['name']}"
                    )

                except Exception as method_error:

                    logger.exception(
                        "Failed to ingest %s.%s",
                        class_name,
                        method["name"],
                    )

                    failed.append(
                        {
                            "entity": (
                                f"{class_name}."
                                f"{method['name']}"
                            ),
                            "error": (
                                friendly_error_message(
                                    method_error
                                )
                            ),
                        }
                    )

        except Exception as file_error:

            logger.exception(
                "Failed to process file=%s",
                filename,
            )

            failed.append(
                {
                    "entity": filename,
                    "error": (
                        friendly_error_message(
                            file_error
                        )
                    ),
                }
            )

    logger.info(
        "Ingestion complete. "
        "success=%d failed=%d",
        len(ingested),
        len(failed),
    )

    return {
        "status": (
            "completed_with_errors"
            if failed
            else "ingested"
        ),
        "methods": ingested,
        "failed": failed,
        "total_ingested": len(ingested),
        "total_failed": len(failed),
    }


# ============================================================
# FRONTEND
# ============================================================

if os.path.isdir(FRONTEND_DIR):

    app.mount(
        "/",
        StaticFiles(
            directory=FRONTEND_DIR,
            html=True,
        ),
        name="frontend",
    )

else:

    logger.warning(
        "Frontend directory not found: %s",
        FRONTEND_DIR,
    )


# ============================================================
# LOCAL DEVELOPMENT
# ============================================================

if __name__ == "__main__":

    import uvicorn

    port = int(
        os.environ.get(
            "PORT",
            8000,
        )
    )

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=port,
        reload=True,
    )
