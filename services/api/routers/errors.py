"""Map the domain errors of the governance service to HTTP status codes."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from fastapi import HTTPException

from services.governance.alerts import AlertError, AlertStateError
from services.governance.engagement import EngagementError
from services.governance.event_store import EventValidationError
from services.governance.personal import PersonalDataError, PersonalDataUnavailable
from services.governance.proposals import ProposalError, ProposalForbidden, ProposalStateError


@contextmanager
def domain_errors(conn=None) -> Iterator[None]:
    """Roll back and raise the HTTP error that fits the domain error.

    403: a user approves an own proposal. 404: an unknown id. 409: the object is already decided.
    422: the request breaks a rule of the domain. 503: the master key for personal data is missing.
    """
    try:
        yield
    except HTTPException:
        if conn is not None:
            conn.rollback()
        raise
    except PermissionError as exc:  # ProposalForbidden and the forbidden errors of other modules
        if conn is not None:
            conn.rollback()
        raise HTTPException(403, str(exc)) from exc
    except LookupError as exc:
        if conn is not None:
            conn.rollback()
        raise HTTPException(404, str(exc).strip("'")) from exc
    except (ProposalStateError, AlertStateError) as exc:
        if conn is not None:
            conn.rollback()
        raise HTTPException(409, str(exc)) from exc
    except PersonalDataUnavailable as exc:
        if conn is not None:
            conn.rollback()
        raise HTTPException(503, str(exc)) from exc
    except (ProposalError, AlertError, EngagementError, PersonalDataError, EventValidationError) as exc:
        if conn is not None:
            conn.rollback()
        raise HTTPException(422, str(exc)) from exc


__all__ = ["domain_errors", "ProposalForbidden"]
