"""
Thin wrapper around the Hindsight Cloud API.

Only three operations matter to us: retain(), recall(), reflect().
Everything else (consolidation, TEMPR search, the Mental Model -> Observation ->
Fact priority order) happens on Hindsight's servers -- we never reimplement it.

Verified against https://hindsight.vectorize.io/api-reference directly:
  POST /v1/default/banks/{bank_id}/memories          <- retain
  POST /v1/default/banks/{bank_id}/memories/recall    <- recall
  POST /v1/default/banks/{bank_id}/reflect            <- reflect, body field is
                                                          "query", not "question"
  Auth: Authorization header.

IMPORTANT (verified against the docs, not assumed):
  - reflect() does NOT return a staleness flag or a confidence score. We only get
    `text` and `based_on` (which memories/mental models/directives were cited).
    Any "CONFIRMED / INFERRED / STALE" badge shown in the UI is computed by US,
    in staleness.py, not read off this API.
  - Mental Models are curated, not auto-generated -- create_mental_model() below
    is something WE call deliberately, not something that appears on its own.
"""
import os
import requests

HINDSIGHT_BASE_URL = os.environ.get("HINDSIGHT_BASE_URL", "https://api.hindsight.vectorize.io")
HINDSIGHT_API_KEY = os.environ.get("HINDSIGHT_API_KEY")
HINDSIGHT_BANK_ID = os.environ.get("HINDSIGHT_BANK_ID")


class HindsightClient:
    def __init__(self, api_key: str = None, bank_id: str = None, base_url: str = None):
        self.api_key = api_key or HINDSIGHT_API_KEY
        self.bank_id = bank_id or HINDSIGHT_BANK_ID
        self.base_url = (base_url or HINDSIGHT_BASE_URL).rstrip("/")
        if not self.api_key or not self.bank_id:
            raise RuntimeError(
                "HINDSIGHT_API_KEY and HINDSIGHT_BANK_ID must be set (see .env.example)"
            )
        self._session = requests.Session()
        self._session.headers.update({
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        })

    def _url(self, path: str) -> str:
        return f"{self.base_url}/v1/default/banks/{self.bank_id}{path}"

    def _post(self, path: str, payload: dict) -> dict:
        r = self._session.post(self._url(path), json=payload, timeout=60)
        if not r.ok:
            try:
                detail = r.json()
            except ValueError:
                detail = r.text
            raise requests.HTTPError(f"{r.status_code} calling {path}: {detail}", response=r)
        return r.json()

    def retain(self, content: str, entities: list[str] = None, kind: str = "world",
               metadata: dict = None) -> dict:
        """
        Store a memory. `entities` is how we tag a fact to a code element
        (e.g. ["ApplyLateFee", "BillingService"]) so later facts about the same
        method get linked into the same Observation during consolidation.

        /memories is a batch endpoint -- verified from the server's own 422
        error, it requires the payload wrapped in "items", even for one memory.
        Also confirmed by the server: metadata values must be strings (not
        bool/int), and entities must be objects, not bare strings.
        """
        merged_metadata = {**(metadata or {}), "kind": kind}
        string_metadata = {k: str(v) for k, v in merged_metadata.items()}
        entity_objects = [{"text": e} for e in (entities or [])]

        item = {
            "content": content,
            "entities": entity_objects,
            "metadata": string_metadata,
        }
        return self._post("/memories", {"items": [item]})
    def recall(self, query: str, top_k: int = 3, entities: list[str] = None) -> dict:
        payload = {"query": query, "top_k": top_k}
        if entities:
            payload["entities"] = entities
        return self._post("/memories/recall", payload)

    def reflect(self, question: str, include_tool_calls: bool = True) -> dict:
        payload = {"query": question}
        return self._post("/reflect", payload)

    def create_mental_model(self, name: str, content: str) -> dict:
        payload = {"name": name, "content": content}
        return self._post("/mental-models", payload)