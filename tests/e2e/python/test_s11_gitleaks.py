"""docs/09 scenario 11: a gitleaks scan runs on the repository and its history. Zero findings.

The scan uses the zricethezav/gitleaks image and .gitleaks.toml, like `make gitleaks` and the CI job. It scans every
commit (git mode). In a git worktree, .git is a file that points to the main repository, so the test mounts that
directory too. E2E_GITLEAKS_IMAGE can pin another image tag.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
from pathlib import Path

from .stack import REPO_ROOT

IMAGE = os.environ.get("E2E_GITLEAKS_IMAGE", "zricethezav/gitleaks:latest")


def _git_mounts(root: Path) -> list[str]:
    common = subprocess.run(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"], cwd=root,
                            capture_output=True, text=True, check=True).stdout.strip()
    mounts = ["-v", f"{root}:{root}"]
    if not Path(common).is_relative_to(root):
        mounts += ["-v", f"{common}:{common}"]
    return mounts


def test_s11_gitleaks_finds_zero_secrets_in_the_repository_and_its_history(tmp_path):
    root = REPO_ROOT.resolve()
    report = tmp_path / "gitleaks.json"
    commits = int(subprocess.run(["git", "rev-list", "--count", "--no-merges", "HEAD"], cwd=root, capture_output=True, text=True,
                                 check=True).stdout)
    cmd = ["docker", "run", "--rm", *_git_mounts(root), "-v", f"{tmp_path}:/out", "-w", str(root), IMAGE,
           "detect", "--source", str(root), "--config", str(root / ".gitleaks.toml"), "--redact",
           "--report-format", "json", "--report-path", "/out/gitleaks.json", "--exit-code", "1"]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=900)
    log = re.sub(r"\x1b\[[0-9;]*m", "", result.stdout + result.stderr)
    match = re.search(r"(\d+) commits scanned", log)
    assert match, log[-2000:]
    scanned = int(match.group(1))
    assert scanned >= commits, (scanned, commits)
    findings = json.loads(report.read_text()) if report.exists() else []
    # The report is redacted. It shows the rule and the place only.
    assert result.returncode == 0 and findings == [], [(f["RuleID"], f["File"], f["Commit"][:8]) for f in findings]
