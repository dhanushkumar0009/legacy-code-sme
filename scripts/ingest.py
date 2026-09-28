"""
Ingestion script: parse a legacy C#/Java repo by method, ask Groq to draft a
plain-English explanation of each one, and retain() it into Hindsight tagged
by class + method name so later facts about the same method link together.

Uses a regex-based method splitter rather than a full parser (tree-sitter/
Roslyn) to keep the hackathon build simple. Good enough for demo-scale files;
swap in tree-sitter if you need this to survive a real repo.

Usage:
    python scripts/ingest.py backend/data/sample_legacy_repo
    python scripts/ingest.py backend/data/sample_legacy_repo_changed   # Beat 4
"""
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

from agent.hindsight_client import HindsightClient
from agent.groq_client import GroqAgentClient
from agent import staleness

METHOD_PATTERN = re.compile(
    r"(?:public|private|protected|internal)\s+[\w<>\[\],\s]+\s+(\w+)\s*\([^)]*\)\s*\{",
    re.MULTILINE,
)
CLASS_PATTERN = re.compile(r"class\s+(\w+)")


def extract_methods(source: str) -> list[dict]:
    """Very simple brace-matching extractor: find each method signature match,
    then walk forward counting braces to find its body."""
    methods = []
    for m in METHOD_PATTERN.finditer(source):
        name = m.group(1)
        start = m.end() - 1  # position of the opening '{'
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


def explain_method(groq: GroqAgentClient, class_name: str, method: dict) -> str:
    prompt = (
        f"You are reverse-engineering an undocumented legacy C#/Java class "
        f"called {class_name}. Read this method and write a short, plain-English "
        f"explanation (2-4 sentences) of what business logic it implements. "
        f"Be specific about conditions and edge cases you can see in the code. "
        f"Do not guess at anything not visible in the code.\n\n"
        f"```\n{method['body']}\n```"
    )
    message = groq.chat([{"role": "user", "content": prompt}])
    return message.content.strip()


def ingest_directory(path: str):
    hindsight = HindsightClient()
    groq = GroqAgentClient()

    for filename in os.listdir(path):
        if not filename.endswith((".cs", ".java")):
            continue
        filepath = os.path.join(path, filename)
        source = open(filepath, encoding="utf-8").read()

        class_match = CLASS_PATTERN.search(source)
        class_name = class_match.group(1) if class_match else filename

        methods = extract_methods(source)
        print(f"{filename}: found {len(methods)} methods in class {class_name}")

        for method in methods:
            explanation = explain_method(groq, class_name, method)
            entity_tag = method["name"]  # consistent tag across re-ingestions

            hindsight.retain(
                content=f"{class_name}.{method['name']}: {explanation}",
                entities=[entity_tag, class_name],
                kind="world",
                metadata={"type": "code_derived_inference", "file": filename},
            )
            staleness.mark_code_seen(entity_tag, explanation)

            print(f"  retained {class_name}.{method['name']} -> {explanation[:80]}...")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python scripts/ingest.py <path-to-repo-dir>")
        sys.exit(1)
    ingest_directory(sys.argv[1])