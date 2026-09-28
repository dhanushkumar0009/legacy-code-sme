import os
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
import re


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

METHOD_PATTERN = re.compile(
    r"(?:public|private|protected|internal)\s+[\w<>\[\],\s]+\s+(\w+)\s*\([^)]*\)\s*\{",
    re.MULTILINE,
)
CLASS_PATTERN = re.compile(r"class\s+(\w+)")


def _extract_methods(source: str) -> list[dict]:
    methods = []
    for m in METHOD_PATTERN.finditer(source):
        name = m.group(1)
        start = m.end() - 1
        depth = 0
        end = start
        for i in range(start, len(source)):
            if source[i] == "{":
                depth += 1
            elif source[i] == "}":
                depth -= 1
                if depth == 0:
                    end = i + 1
                    break
        body = source[m.start():end]
        methods.append({"name": name, "body": body})
    return methods


@app.get("/admin/ingest")
def admin_ingest(dir_name: str = "sample_legacy_repo"):
    path = os.path.join(os.path.dirname(__file__), "data", dir_name)
    if not os.path.isdir(path):
        raise HTTPException(status_code=404, detail=f"No such data dir: {path}")

    ingested = []
    for filename in os.listdir(path):
        if not filename.endswith((".cs", ".java")):
            continue
        source = open(os.path.join(path, filename), encoding="utf-8").read()
        class_match = CLASS_PATTERN.search(source)
        class_name = class_match.group(1) if class_match else filename
        for method in _extract_methods(source):
            prompt = (
                f"You are reverse-engineering an undocumented legacy C#/Java class "
                f"called {class_name}. Read this method and write a short, plain-English "
                f"explanation (2-4 sentences) of what business logic it implements. "
                f"Be specific about conditions and edge cases you can see in the code. "
                f"Do not guess at anything not visible in the code.\n\n"
                f"```\n{method['body']}\n```"
            )
            explanation = groq.chat([{"role": "user", "content": prompt}]).content.strip()
            hindsight.retain(
                content=f"{class_name}.{method['name']}: {explanation}",
                entities=[method["name"], class_name],
                kind="world",
                metadata={"type": "code_derived_inference", "file": filename},
            )
            staleness.mark_code_seen(method["name"], explanation)
            ingested.append(f"{class_name}.{method['name']}")
    return {"status": "ingested", "methods": ingested}
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