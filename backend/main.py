import os
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from agent.hindsight_client import HindsightClient
from agent.groq_client import GroqAgentClient
from agent.tools import TOOL_SCHEMAS, make_tool_impls
from agent.prompts import SYSTEM_PROMPT
from agent import staleness

app = FastAPI(title="Legacy Code SME")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten before real deployment
    allow_methods=["*"],
    allow_headers=["*"],
)

hindsight = HindsightClient()
groq = GroqAgentClient()
tool_impls = make_tool_impls(hindsight)


class ChatRequest(BaseModel):
    message: str
    user_name: str = "unknown reviewer"
    history: list[dict] = []  # [{"role": "user"|"assistant", "content": "..."}]


class ChatResponse(BaseModel):
    reply: str


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/chat", response_model=ChatResponse)
def chat(req: ChatRequest):
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    messages += req.history
    messages.append({
        "role": "user",
        "content": f"[speaking as: {req.user_name}] {req.message}",
    })

    try:
        reply = groq.run_with_tools(messages, TOOL_SCHEMAS, tool_impls)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return ChatResponse(reply=reply)


@app.get("/memories")
def memories():
    """Powers the 'what the agent remembers' panel in the UI."""
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


class ReingestRequest(BaseModel):
    entity: str
    new_explanation: str


@app.post("/simulate-code-change")
def simulate_code_change(req: ReingestRequest):
    """
    Demo hook for Beat 4 of the demo script: simulates re-ingesting a file
    after a developer edited it. In a real deployment this would be called
    from a git post-commit hook or CI job, one call per changed method.
    """
    hindsight.retain(
        content=req.new_explanation,
        entities=[req.entity],
        kind="world",
        metadata={"type": "code_change_reingest"},
    )
    staleness.mark_code_seen(req.entity, req.new_explanation)
    return {"status": "reingested", "entity": req.entity, "badge": staleness.status(req.entity).badge}


# Serve the frontend as static files. Mounted LAST so it only catches
# requests that don't match any API route above (e.g. "/" and "/index.html").
app.mount(
    "/",
    StaticFiles(directory=os.path.join(os.path.dirname(__file__), "..", "frontend"), html=True),
    name="frontend",
)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=int(os.environ.get("PORT", 8000)), reload=True)