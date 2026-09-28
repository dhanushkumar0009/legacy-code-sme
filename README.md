# Legacy Code SME

An AI Subject-Matter-Expert for undocumented legacy Java/.NET codebases, built on
Hindsight, for HackwithHyderabad 3.0. It doesn't just search code — it builds a
validated understanding of business logic that compounds over time and knows
when it's gone stale.

## The problem

Every mature company has a codebase where the business logic lives only in the
code itself — undocumented, and understood fully by two or three senior
engineers who become permanent bottlenecks. New developers spend weeks
reverse-engineering a module before touching it. Business analysts can't write
specs without pulling a senior dev into a meeting.

## How it works

```
Legacy repo → parse by method → Groq explains each one → retain() as a
World Fact, tagged by entity name
                    ↓
Developer/BA asks a question → recall_codebase() (Hindsight's TEMPR search)
→ get_entity_confidence() (our own staleness layer) → answer, labeled
CONFIRMED / INFERRED / STALE
                    ↓
Human confirms or corrects → record_validation() → retained as a new World
Fact → Hindsight consolidates it into an Observation automatically
                    ↓
Code changes → re-ingestion retains a new fact for that entity → our
staleness layer flags the entity STALE until re-validated
```

## How Hindsight memory is used (required explanation)

| Hindsight concept | Role in this project |
|---|---|
| **World Fact** | Every code-derived explanation and every human correction is retained as a World Fact, tagged with the method/class name as its `entities` list. |
| **Observation (consolidation)** | Runs automatically after every `retain()` call. Merges the AI's original guess and the human's correction into one settled, evidence-backed belief — this is what makes the second developer's question instant instead of a re-guess. |
| **`reflect()` priority order** | Fixed hierarchy: Mental Models → Observations → raw Facts. We rely on this instead of writing our own trust logic. |
| **TEMPR recall** | `recall_codebase()` uses Hindsight's semantic + keyword + graph + temporal search in parallel — semantic for "what handles overdue billing," keyword for exact method names, graph for related methods, temporal for "what changed recently." |
| **Mission / Directives** | Set once via `hindsight_client.set_mission_and_directives()`: mission = "prioritize human-validated knowledge over your own inference"; directive = "never present an unvalidated fact as confirmed." |

### What Hindsight does **not** provide (verified against the API, not assumed)

- **No staleness flag in the API response.** `reflect()` returns `text` and
  `based_on` only — no confidence score, no source-tier label, no staleness
  flag. Hindsight tracks staleness internally to decide what to trust while
  reasoning, but never exposes it to the client. **`backend/agent/staleness.py`
  is our own layer** that computes the CONFIRMED/INFERRED/STALE badge by
  comparing a locally-tracked `last_validated_at` against `last_code_changed_at`
  per entity.
- **Mental Models are curated, not auto-generated.** Unlike Observations, they
  don't emerge from consolidation — `create_mental_model()` has to be called
  deliberately.
- **Entity linking across `retain()` calls is undocumented.** Run
  `scripts/verify_consolidation.py` first, before building anything else, to
  confirm that two facts tagged with the same entity name actually get linked
  into one Observation.

## Setup

```bash
cp .env.example .env   # fill in GROQ_API_KEY, HINDSIGHT_API_KEY, HINDSIGHT_BANK_ID

cd backend
pip install -r requirements.txt
python main.py          # serves on :8000
```

Open `frontend/index.html` directly in a browser (or serve it with any static
server) — it talks to `http://localhost:8000` by default. To point it at a
deployed backend, set `window.LEGACY_SME_API_BASE` before the script tag loads.

### Day 1: verify the core assumption first

```bash
python scripts/verify_consolidation.py
```

Confirms Hindsight actually links two facts about the same entity into one
Observation. If it doesn't, see the fallback in the doc: track staleness
entirely in `staleness.py` and use Hindsight only for Q&A/consolidation of
the explanation text itself.

### Ingest the sample legacy repo

```bash
python scripts/ingest.py backend/data/sample_legacy_repo
```

### Demo Beat 4 — simulate a code change

```bash
python scripts/ingest.py backend/data/sample_legacy_repo_changed
```

This re-ingests a modified `BillingService.cs` (ApplyLateFee now takes a
`region` parameter and has region-dependent grace periods). Ask the agent
about `ApplyLateFee` again — it should flag the entity STALE.

## Project structure

```
backend/
  main.py                  FastAPI app: /chat, /memories, /simulate-code-change
  agent/
    hindsight_client.py    retain() / recall() / reflect() wrapper
    grthe LLM can call
    staleness.py            Our own confidence/staleness tracking (SQLite)
    prompts.py               System prompt
  data/sample_legacy_repo/  Seed legacy C# files
frontend/
  index.html                Chat UI + "what the agent remembers" panel
scripts/
  ingest.py                  Parses a repo dir, explains each method, retains it
  verify_consolidation.py    Day-1 check: does entity tagging actually link facts?
```

## Deployment

- Frontend: Vercel/Netlify (static).
- Backend: Render or Railway free tier, or Fly.io.
- Hindsight: Hindsight Cloud (promo code `MEMHACK99`).

## Demo script

| Beat | What happens | What the judge sees |
|---|---|---|
| 1 | Ask "what does ApplyLateFee do?" — cold start | Hedged answer, badge INFERRED |
| 2 | Correct it in chat: confirms logic, adds enterprise exception | Agent calls `record_validation`, badge → CONFIRMED |
| 3 | A different session asks the same question | Instant, confident answer citing the validation |
| 4 | Run `ingest.py` on `sample_legacy_repo_changed` | Badge flips to STALE; agent flags the change and offers to re-verify |
| 5 | Ask for a user story from validated knowledge only | Agent excludes anything not CONFIRMED |
