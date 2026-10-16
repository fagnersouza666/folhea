#!/usr/bin/env python3
"""Run the pinned Gitleaks over all ancestors of HEAD without publishing values."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile


VERSION = "8.30.1"


def scan(repository, binary):
    repository = repository.resolve(strict=True)
    config = repository / ".gitleaks.toml"
    if not config.is_file() or config.is_symlink():
        raise ValueError("missing scanner configuration")
    fingerprint_ignore = repository / ".gitleaksignore"
    if fingerprint_ignore.exists() or fingerprint_ignore.is_symlink():
        print("Repository fingerprint ignore files are not allowed.", file=sys.stderr)
        return 2
    git = ["git", "-C", str(repository)]
    shallow = subprocess.check_output(git + ["rev-parse", "--is-shallow-repository"],
                                      stderr=subprocess.DEVNULL, timeout=30).strip()
    if shallow != b"false":
        print("Gitleaks requires full Git history (fetch-depth: 0).", file=sys.stderr)
        return 2
    revision = subprocess.check_output(git + ["rev-parse", "--verify", "HEAD^{commit}"],
                                       stderr=subprocess.DEVNULL, timeout=30).decode().strip()
    if len(revision) != 40 or any(c not in "0123456789abcdef" for c in revision):
        raise ValueError("invalid revision")
    version = subprocess.check_output([binary, "version"], stderr=subprocess.DEVNULL,
                                      timeout=30).decode().strip()
    if version != VERSION:
        raise ValueError("unexpected scanner version")
    with tempfile.TemporaryDirectory(prefix="folhea-gitleaks-") as directory:
        # No raw finding, source line, author, or value goes to Actions output or
        # artifacts. Private reports/logs are removed on both success and failure.
        report = Path(directory) / "findings.redacted.json"
        log = Path(directory) / "scanner.private.log"
        # Gitleaks also reads source/.gitleaksignore independently of this flag
        # (v8.30.1 cmd/root.go); reject that file above, supply no other waivers.
        ignore = Path(directory) / ".gitleaksignore"
        ignore.touch(mode=0o600)
        descriptor = os.open(log, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "wb") as output:
            result = subprocess.run([
                binary, "git", str(repository), "--config", str(config),
                "--log-opts=--full-history --diff-merges=separate --no-renames " + revision,
                "--redact=100", "--no-banner",
                "--log-level", "warn", "--exit-code", "1", "--timeout", "600",
                "--ignore-gitleaks-allow", "--gitleaks-ignore-path", str(ignore),
                "--report-format", "json", "--report-path", str(report),
            ], stdout=output, stderr=output, timeout=630, umask=0o077)
        if result.returncode not in (0, 1) or not report.is_file():
            raise ValueError("scanner did not complete")
        findings = json.loads(report.read_text())
        if not isinstance(findings, list):
            raise ValueError("invalid scanner report")
        if result.returncode == 1 and not findings:
            raise ValueError("inconsistent scanner result")
        print(f"Gitleaks {VERSION}: {len(findings)} findings; full HEAD history scanned. "
              "Values and source details withheld.")
        return 1 if findings else 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repository", type=Path, default=Path.cwd())
    parser.add_argument("--gitleaks", default="gitleaks")
    arguments = parser.parse_args()
    try:
        return scan(arguments.repository, arguments.gitleaks)
    except (OSError, ValueError, subprocess.SubprocessError):
        # Exception strings and child output can contain source/secret material.
        print("Gitleaks scan failed closed; no finding details published.", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
