"""The deterministic backend: rules from config/enrichment-rules.yaml, no model and no randomness.

It records the model id and the rules version from the configuration (model_id "deterministic-v1",
prompt_version = the rules version).
"""

from __future__ import annotations

import time

from .. import config, rules
from .base import AgentError, CallInfo


class DeterministicBackend:
    name = "deterministic"

    def __init__(self) -> None:
        self.last_call: CallInfo | None = None

    def model_id(self, agent: str) -> str:
        return str(config.get("model_id", "deterministic-v1"))

    def prompt_version(self, agent: str) -> str:
        return str(config.get("version", "rules-v1"))

    def call(self, agent: str, prompt_version: str, document: str, context: dict, output_schema: dict) -> dict:
        fn = rules.AGENTS.get(agent)
        if fn is None:
            raise AgentError("backend_error", {"error": f"no deterministic rules for agent {agent}"})
        started = time.perf_counter()
        output = fn(document, context)
        self.last_call = CallInfo(
            backend=self.name, model_id=self.model_id(agent), prompt_version=prompt_version,
            latency_ms=int((time.perf_counter() - started) * 1000), stop_reason="end_turn",
        )
        return output
