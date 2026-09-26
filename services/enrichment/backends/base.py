"""The backend interface of the agents.

A backend has one method: call(agent, prompt_version, document, context, output_schema) -> dict.
It returns the agent output as a dict. After each call, backend.last_call holds the call data for the
log (docs/05 guardrail 8): model id, prompt version, tokens, latency and the stop reason.

Context keys that start with "_" are private to the deterministic rules. A model backend never sends them.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol


@dataclass
class CallInfo:
    backend: str
    model_id: str
    prompt_version: str
    input_tokens: int | None = None
    output_tokens: int | None = None
    latency_ms: int = 0
    stop_reason: str | None = None
    raw_output: Any = None


class AgentError(Exception):
    """A backend failure that sends the output to quarantine with a reason code."""

    def __init__(self, reason_code: str, detail: dict | None = None, output: Any = None):
        super().__init__(reason_code)
        self.reason_code = reason_code
        self.detail = detail or {}
        self.output = output


class Backend(Protocol):
    name: str
    last_call: CallInfo | None

    def model_id(self, agent: str) -> str: ...

    def prompt_version(self, agent: str) -> str: ...

    def call(self, agent: str, prompt_version: str, document: str, context: dict, output_schema: dict) -> dict: ...


def public_context(context: dict) -> dict:
    return {k: v for k, v in context.items() if not k.startswith("_")}


@dataclass
class ScriptedBackend:
    """A test backend that returns scripted outputs for each agent, for example a model output with a wrong value."""

    outputs: dict[str, list[dict]] = field(default_factory=dict)
    fallback: Any = None
    name: str = "scripted"
    last_call: CallInfo | None = None
    calls: list[tuple[str, dict]] = field(default_factory=list)

    def model_id(self, agent: str) -> str:
        return "scripted-model"

    def prompt_version(self, agent: str) -> str:
        return f"{agent}/scripted"

    def call(self, agent: str, prompt_version: str, document: str, context: dict, output_schema: dict) -> dict:
        self.calls.append((agent, context))
        queue = self.outputs.get(agent)
        if queue:
            output = queue.pop(0)
            self.last_call = CallInfo(self.name, self.model_id(agent), prompt_version, raw_output=output)
            if isinstance(output, AgentError):
                raise output
            return output
        if self.fallback is None:
            raise AgentError("backend_error", {"error": f"no scripted output for {agent}"})
        output = self.fallback.call(agent, self.fallback.prompt_version(agent), document, context, output_schema)
        self.last_call = self.fallback.last_call
        return output
