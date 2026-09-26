"""Write the OpenAPI schema of the API to a file. CI builds the typed client from it."""

from __future__ import annotations

import json
import sys

from services.api.main import app


def main() -> None:
    out = sys.argv[1] if len(sys.argv) > 1 else "packages/api-client/openapi.json"
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(app.openapi(), fh, indent=2, sort_keys=True)
        fh.write("\n")
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
