"""Strata API. Publishes the OpenAPI schema at /api/openapi.json."""

from __future__ import annotations

import asyncio
import json
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from sse_starlette.sse import EventSourceResponse

from services.common.db import close_pool, connection
from services.common.ids import new_id
from services.common.logging import setup_logging

from .auth import User, current_user, require_viewer
from .live import broadcaster
from .routers import include_routers


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging()
    broadcaster.start()
    yield
    await broadcaster.stop()
    close_pool()


app = FastAPI(
    title="Strata API",
    version="0.1.0",
    openapi_url="/api/openapi.json",
    docs_url="/api/docs",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:8088"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health", tags=["system"])
def health() -> dict:
    with connection() as conn:
        conn.execute("SELECT 1")
    return {"status": "ok"}


@app.get("/api/me", tags=["session"])
def me(user: User = Depends(require_viewer)) -> dict:
    return {"id": user.id, "email": user.email, "name": user.name, "roles": user.roles, "role": user.top_role}


def _security_log(user: User, action: str, detail: dict | None = None) -> None:
    from psycopg.types.json import Jsonb

    with connection() as conn:
        prev = conn.execute("SELECT roles FROM app_user WHERE id = %s", (user.id,)).fetchone()
        conn.execute(
            "INSERT INTO app_user (id, email, name, roles, last_seen_at) VALUES (%s, %s, %s, %s, now()) "
            "ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name, last_seen_at = now(), roles = EXCLUDED.roles",
            (user.id, user.email, user.name, user.roles),
        )
        conn.execute(
            "INSERT INTO security_log (id, user_id, action, detail) VALUES (%s, %s, %s, %s)",
            (new_id(), user.id, action, Jsonb(detail or {})),
        )
        if prev and sorted(prev["roles"]) != sorted(user.roles):
            conn.execute(
                "INSERT INTO security_log (id, user_id, action, detail) VALUES (%s, %s, 'permission_change', %s)",
                (new_id(), user.id, Jsonb({"from": prev["roles"], "to": user.roles})),
            )
        conn.commit()


@app.post("/api/session/login", tags=["session"])
def session_login(user: User = Depends(current_user)) -> dict:
    _security_log(user, "login")
    return {"status": "logged_in", "role": user.top_role}


@app.post("/api/session/logout", tags=["session"])
def session_logout(user: User = Depends(current_user)) -> dict:
    _security_log(user, "logout")
    return {"status": "logged_out"}


@app.get("/api/live", tags=["live"])
async def live(request: Request, user: User = Depends(require_viewer)):
    queue = broadcaster.subscribe()

    async def stream():
        try:
            yield {"event": "hello", "data": json.dumps({"user": user.id})}
            while True:
                if await request.is_disconnected():
                    break
                try:
                    message = await asyncio.wait_for(queue.get(), timeout=15)
                    yield {"event": message.get("event_type") or message.get("kind") or "event", "data": json.dumps(message)}
                except TimeoutError:
                    yield {"event": "ping", "data": "{}"}
        finally:
            broadcaster.unsubscribe(queue)

    return EventSourceResponse(stream())


include_routers(app)
