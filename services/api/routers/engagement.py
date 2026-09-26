"""Kanban stage moves and the relationship work of the team. Source: docs/03-data-model.md (relationships and
engagement), docs/06-governance.md and docs/api-contract.md.

An analyst moves a card: a DealStageChanged proposal that an approver decides. The engagement endpoints
write ContactAdded, TouchpointLogged, NextActionSet and PrequalificationStatusChanged as human events
through the governance service (policy automatic, the user is the actor).
"""

from __future__ import annotations

import datetime as dt
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from services.common.db import connection
from services.governance import engagement

from ..auth import User, require_analyst
from .errors import domain_errors
from .schemas import EngagementResult, StageMoveResult

router = APIRouter(prefix="/api", tags=["engagement"])


class StageMove(BaseModel):
    to_stage: str = Field(min_length=1)
    reason: str | None = Field(None, max_length=2000)


class Contact(BaseModel):
    name: str | None = Field(None, max_length=200)
    role: str = Field(min_length=1, max_length=200)
    organisation_id: str | None = None
    email: str | None = Field(None, max_length=320, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    phone: str | None = Field(None, max_length=40, pattern=r"^[+0-9 ()./-]{5,40}$")
    found_via: str = Field(min_length=1, max_length=500)
    person_id: str | None = Field(None, description="An existing person entity. Without it, the business email "
                                                     "(or the name and the organisation) finds or creates the person.")


class Touchpoint(BaseModel):
    kind: Literal["call", "meeting", "email", "site_visit"]
    date: dt.date
    note: str = Field(max_length=2000)
    contact_id: str | None = None


class NextAction(BaseModel):
    action: str = Field(min_length=1, max_length=500)
    owner_user_id: str = Field(min_length=1)
    due_date: dt.date


class Prequalification(BaseModel):
    buyer_id: str = Field(min_length=1)
    status: Literal["not_started", "submitted", "approved", "rejected"]


@router.post("/deals/{deal_id}/stage", response_model=StageMoveResult)
def move_stage(deal_id: str, body: StageMove, user: User = Depends(require_analyst)) -> dict:
    """A DealStageChanged proposal (policy review). The card shows the pending stage until an approver decides."""
    with connection() as conn, domain_errors(conn):
        result = engagement.move_deal_stage(conn, deal_id, user.id, body.to_stage, body.reason)
        conn.commit()
    return result


@router.post("/deals/{deal_id}/contacts", response_model=EngagementResult)
def add_contact(deal_id: str, body: Contact, user: User = Depends(require_analyst)) -> dict:
    """ContactAdded. The name, business email and business phone are encrypted with the key of the person."""
    with connection() as conn, domain_errors(conn):
        result = engagement.add_contact(conn, deal_id, user.id, name=body.name, role=body.role,
                                        organisation_id=body.organisation_id, email=body.email, phone=body.phone,
                                        found_via=body.found_via, person_id=body.person_id)
        conn.commit()
    return result


@router.post("/deals/{deal_id}/touchpoints", response_model=EngagementResult)
def log_touchpoint(deal_id: str, body: Touchpoint, user: User = Depends(require_analyst)) -> dict:
    with connection() as conn, domain_errors(conn):
        result = engagement.log_touchpoint(conn, deal_id, user.id, kind=body.kind, date=body.date.isoformat(),
                                           note=body.note, contact_id=body.contact_id)
        conn.commit()
    return result


@router.post("/deals/{deal_id}/next-action", response_model=EngagementResult)
def set_next_action(deal_id: str, body: NextAction, user: User = Depends(require_analyst)) -> dict:
    with connection() as conn, domain_errors(conn):
        result = engagement.set_next_action(conn, deal_id, user.id, action=body.action,
                                            owner_user_id=body.owner_user_id, due_date=body.due_date.isoformat())
        conn.commit()
    return result


@router.post("/deals/{deal_id}/prequalification", response_model=EngagementResult)
def set_prequalification(deal_id: str, body: Prequalification, user: User = Depends(require_analyst)) -> dict:
    with connection() as conn, domain_errors(conn):
        result = engagement.set_prequalification(conn, deal_id, user.id, buyer_id=body.buyer_id, status=body.status)
        conn.commit()
    return result
