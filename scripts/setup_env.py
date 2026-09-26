"""Make .env from .env.example and fill each empty secret with a random value.

The script never prints a secret. It keeps an existing .env and only adds missing keys.
"""

from __future__ import annotations

import base64
import os
import secrets
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SECRETS = {
    "POSTGRES_PASSWORD": lambda: secrets.token_urlsafe(24),
    "STRATA_APP_DB_PASSWORD": lambda: secrets.token_urlsafe(24),
    "STRATA_OWNER_DB_PASSWORD": lambda: secrets.token_urlsafe(24),
    "KEYCLOAK_ADMIN_PASSWORD": lambda: secrets.token_urlsafe(18),
    "STRATA_DEV_USER_PASSWORD": lambda: secrets.token_urlsafe(12),
    "STRATA_S3_ACCESS_KEY": lambda: secrets.token_hex(10),
    "STRATA_S3_SECRET_KEY": lambda: secrets.token_urlsafe(30),
    "STRATA_MASTER_KEY": lambda: base64.urlsafe_b64encode(os.urandom(32)).decode(),
}


def main() -> None:
    example = (ROOT / ".env.example").read_text().splitlines()
    env_path = ROOT / ".env"
    existing: dict[str, str] = {}
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            if "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1)
                existing[k] = v
    out = []
    filled = []
    for line in example:
        if "=" not in line or line.startswith("#"):
            out.append(line)
            continue
        key, value = line.split("=", 1)
        if existing.get(key):
            value = existing[key]
        elif key in SECRETS and not value:
            value = SECRETS[key]()
            filled.append(key)
        elif key == "ANTHROPIC_API_KEY" and os.environ.get(key):
            value = os.environ[key]
        out.append(f"{key}={value}")
    env_path.write_text("\n".join(out) + "\n")
    env_path.chmod(0o600)
    print(f".env ready. New secrets: {', '.join(filled) if filled else 'none'}")
    print("The password of the development users is STRATA_DEV_USER_PASSWORD in .env.")


if __name__ == "__main__":
    main()
