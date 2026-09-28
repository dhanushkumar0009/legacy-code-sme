"""
Groq LLM wrapper with function-calling and retry-on-malformed-call handling.

Groq's smaller open models (openai/gpt-oss-120b, qwen/qwen3-32b) are fast but
occasionally emit malformed tool calls (wrong arg names, invalid JSON, or a
call to a tool that doesn't exist). We catch and retry those instead of
crashing the request -- this is the "handle function-calling failures" the
hackathon brief explicitly calls out.

We do NOT retry on a "request too large" / rate-limit error -- the payload
doesn't shrink between attempts, so retrying just re-sends the same
oversized request and burns through the per-minute token budget faster.
"""
import os
import json
import logging
from groq import Groq

logger = logging.getLogger("groq_client")

DEFAULT_MODEL = os.environ.get("GROQ_MODEL", "openai/gpt-oss-120b")
MAX_TOOL_RETRIES = 2


def _is_non_retryable(e: Exception) -> bool:
    """True for errors where retrying with the same payload can't help --
    e.g. Groq's 413 'request too large' / rate_limit_exceeded errors."""
    msg = str(e).lower()
    return "rate_limit_exceeded" in msg or "request too large" in msg or "413" in msg


class GroqAgentClient:
    def __init__(self, api_key: str = None, model: str = None):
        self.client = Groq(api_key=api_key or os.environ["GROQ_API_KEY"])
        self.model = model or DEFAULT_MODEL

    def chat(self, messages: list[dict], tools: list[dict] = None, temperature: float = 0.2):
        """
        Single completion call. Returns the raw Groq message object.

        Groq's API rejects an explicit tool_choice=null -- it must be omitted
        entirely when there are no tools, not passed as None.
        """
        kwargs = {"model": self.model, "messages": messages, "temperature": temperature}
        if tools:
            kwargs["tools"] = tools
            kwargs["tool_choice"] = "auto"

        resp = self.client.chat.completions.create(**kwargs)
        return resp.choices[0].message

    def run_with_tools(self, messages: list[dict], tools: list[dict], tool_impls: dict,
                        max_steps: int = 6) -> str:
        """
        Runs the agent loop: model decides which tool to call (recall / reflect /
        our own domain tools), we execute it, feed the result back, repeat until
        the model returns a plain text answer or we hit max_steps.
        """
        working_messages = list(messages)

        for step in range(max_steps):
            message = self._chat_with_retry(working_messages, tools)

            if not message.tool_calls:
                return message.content or ""

            working_messages.append({
                "role": "assistant",
                "content": message.content or "",
                "tool_calls": [tc.model_dump() for tc in message.tool_calls],
            })

            for tool_call in message.tool_calls:
                result = self._execute_tool_call(tool_call, tool_impls)
                working_messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": json.dumps(result),
                })

        return "I ran out of reasoning steps -- here's what I have so far: " + (
            working_messages[-1].get("content", "") if working_messages else ""
        )

    def _chat_with_retry(self, messages: list[dict], tools: list[dict]):
        last_error = None
        for attempt in range(MAX_TOOL_RETRIES + 1):
            try:
                return self.chat(messages, tools)
            except Exception as e:  # malformed tool schema, rate limit, etc.
                last_error = e
                logger.warning("Groq call failed (attempt %d): %s", attempt + 1, e)
                if _is_non_retryable(e):
                    break
        raise RuntimeError(f"Groq call failed after retries: {last_error}")

    def _execute_tool_call(self, tool_call, tool_impls: dict) -> dict:
        name = tool_call.function.name
        raw_args = tool_call.function.arguments

        if name not in tool_impls:
            return {"error": f"unknown tool '{name}' -- not called"}

        try:
            args = json.loads(raw_args) if raw_args else {}
        except json.JSONDecodeError:
            return {"error": f"malformed arguments for '{name}': could not parse JSON"}

        try:
            return tool_impls[name](**args)
        except TypeError as e:
            return {"error": f"wrong arguments for '{name}': {e}"}
        except Exception as e:
            logger.exception("Tool '%s' raised", name)
            return {"error": f"'{name}' failed: {e}"}