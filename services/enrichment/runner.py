"""Runs one agent call with the guardrails that apply to every agent.

1. The output must match the JSON schema of the agent (config/agent-schemas.yaml). One retry on failure.
2. Each call is logged: backend, model id, prompt version, input hash, output, tokens, latency and status
   (docs/05 guardrail 8).
3. A failure gives a quarantine record with a reason code from config/agent-schemas.yaml.
"""

from __future__ import annotations

import json
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

import jsonschema

from services.common import config as common_config
from services.common.ids import sha256_hex

from . import config
from .backends.base import AgentError, Backend


@dataclass
class QuarantineRecord:
    agent: str
    reason_code: str
    detail: dict
    output: Any = None
    model_id: str | None = None
    prompt_version: str | None = None


@dataclass
class AgentStatus:
    agent: str
    status: str = "not_run"
    backend: str | None = None
    model_id: str | None = None
    prompt_version: str | None = None
    ms: int = 0
    calls: int = 0
    detail: dict = field(default_factory=dict)

    def as_dict(self) -> dict:
        return {"status": self.status, "backend": self.backend, "model_id": self.model_id,
                "prompt_version": self.prompt_version, "ms": self.ms, "calls": self.calls, **self.detail}


def schema_for(agent: str) -> dict:
    doc = config.agent_schemas()
    schema = dict(doc["schemas"][agent])
    schema["definitions"] = doc.get("definitions") or {}
    return schema


def schema_errors(output: Any, schema: dict) -> list[str]:
    validator = jsonschema.Draft7Validator(schema)
    return [f"{'/'.join(str(p) for p in e.absolute_path)}: {e.message}" for e in validator.iter_errors(output)][:10]


def input_hash(agent: str, prompt_version: str, document: str, context: dict) -> str:
    return sha256_hex(json.dumps({"agent": agent, "prompt_version": prompt_version, "document": document,
                                  "context": context}, sort_keys=True, ensure_ascii=False, default=str))


class AgentRunner:
    """Runs the agents of one document on one backend and keeps the statuses and the quarantine records."""

    def __init__(self, backend: Backend, log: Callable[[dict], None] | None = None):
        self.backend = backend
        self.log = log
        self.quarantine: list[QuarantineRecord] = []
        self.statuses: dict[str, AgentStatus] = {}

    def status(self, agent: str) -> AgentStatus:
        return self.statuses.setdefault(agent, AgentStatus(agent))

    def reject(self, agent: str, reason_code: str, detail: dict, output: Any = None) -> None:
        st = self.status(agent)
        self.quarantine.append(QuarantineRecord(agent, reason_code, detail, output, st.model_id, st.prompt_version))

    def mark(self, agent: str, status: str, **detail) -> None:
        st = self.status(agent)
        st.status = status
        st.detail.update(detail)

    def run(self, agent: str, document: str, context: dict) -> dict | None:
        st = self.status(agent)
        schema = schema_for(agent)
        from .backends.anthropic_backend import model_schema

        request_schema = model_schema(agent)
        prompt_version = self.backend.prompt_version(agent)
        st.backend, st.model_id, st.prompt_version = self.backend.name, self.backend.model_id(agent), prompt_version
        digest = input_hash(agent, prompt_version, document, context)
        retries = int(common_config.models()["defaults"].get("retries_on_schema_failure", 1))
        errors: list[str] = []
        output: Any = None
        for _attempt in range(1 + retries):
            started = time.perf_counter()
            st.calls += 1
            try:
                output = self.backend.call(agent, prompt_version, document, context, request_schema)
            except AgentError as exc:
                self._log(agent, digest, exc.output, exc.reason_code, json.dumps(exc.detail, default=str), started)
                st.status = "quarantined"
                self.reject(agent, exc.reason_code, exc.detail, exc.output)
                st.ms += int((time.perf_counter() - started) * 1000)
                return None
            errors = schema_errors(output, schema)
            self._log(agent, digest, output, "ok" if not errors else "schema_invalid",
                      "; ".join(errors) if errors else None, started)
            st.ms += int((time.perf_counter() - started) * 1000)
            if not errors:
                st.status = "ok"
                return output
        st.status = "quarantined"
        self.reject(agent, "schema_invalid", {"errors": errors}, output)
        return None

    def _log(self, agent: str, digest: str, output: Any, status: str, error: str | None, started: float) -> None:
        if self.log is None:
            return
        info = self.backend.last_call
        self.log({
            "agent": agent,
            "backend": self.backend.name,
            "model_id": info.model_id if info else self.backend.model_id(agent),
            "prompt_version": info.prompt_version if info else self.backend.prompt_version(agent),
            "input_hash": digest,
            "output": output,
            "input_tokens": info.input_tokens if info else None,
            "output_tokens": info.output_tokens if info else None,
            "latency_ms": info.latency_ms if info and info.latency_ms else int((time.perf_counter() - started) * 1000),
            "status": status,
            "error": error,
        })
