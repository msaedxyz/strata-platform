"""Worker process: runs the job queue and the schedules. The collectors track fills this in (M2)."""

from __future__ import annotations

import time

from services.common.logging import setup_logging


def main() -> None:
    setup_logging()
    while True:
        time.sleep(3600)


if __name__ == "__main__":
    main()
