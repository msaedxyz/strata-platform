"""Backend selection. STRATA_AGENT_BACKEND: auto (default), anthropic or deterministic.

auto gives the Anthropic backend when ANTHROPIC_API_KEY is set, else the deterministic backend
(config/models.yaml fallback_backend).
"""

from __future__ import annotations

from services.common.settings import get_settings

from .base import AgentError, Backend, CallInfo, ScriptedBackend
from .deterministic import DeterministicBackend

__all__ = ["AgentError", "Backend", "CallInfo", "DeterministicBackend", "ScriptedBackend", "select_backend"]


def select_backend(name: str | None = None) -> Backend:
    settings = get_settings()
    choice = (name or settings.agent_backend or "auto").lower()
    if choice == "auto":
        choice = "anthropic" if settings.anthropic_api_key else "deterministic"
    if choice == "anthropic":
        from .anthropic_backend import AnthropicBackend

        return AnthropicBackend()
    if choice == "deterministic":
        return DeterministicBackend()
    raise ValueError(f"unknown STRATA_AGENT_BACKEND {choice}")
