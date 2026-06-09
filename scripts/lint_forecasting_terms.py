#!/usr/bin/env python3
"""
Forecasting-term linter for BuildTech.

Flags forbidden forecasting/predictive language in source files and UI strings.
This enforces the language discipline lock defined in BuildTech_Project_Plan_v4.md §3.

Forbidden terms (case-insensitive):
  - "expected return"
  - "forecast"
  - "predicted"
  - "projected"
  - "anticipated"

These terms are ONLY permitted in documentation files that explicitly list them
as forbidden (e.g., the project plan, ADRs discussing the ban). They must never
appear in Python source, TypeScript/JavaScript, HTML templates, or CSS strings.

Usage (invoked automatically by pre-commit):
  python scripts/lint_forecasting_terms.py <file1> [file2 ...]

Exit codes:
  0 — no violations found
  1 — one or more forbidden terms found (commit blocked)
"""

import re
import sys
from pathlib import Path

FORBIDDEN_TERMS: list[tuple[str, re.Pattern[str]]] = [
    ("expected return", re.compile(r"expected\s+return", re.IGNORECASE)),
    ("forecast", re.compile(r"\bforecast\b", re.IGNORECASE)),
    ("predicted", re.compile(r"\bpredicted\b", re.IGNORECASE)),
    ("projected", re.compile(r"\bprojected\b", re.IGNORECASE)),
    ("anticipated", re.compile(r"\banticipated\b", re.IGNORECASE)),
]

# Documentation files that may reference these terms in a forbidden-list context.
# These are excluded from linting.
ALLOWED_PATHS: list[re.Pattern[str]] = [
    re.compile(r"BuildTech_Project_Plan_v4\.md$"),
    re.compile(r"[/\\]docs[/\\]"),
    re.compile(r"[/\\]tests[/\\]"),
    re.compile(r"\.md$"),
    re.compile(r"lint_forecasting_terms\.py$"),  # this file itself
]


def is_excluded(path: Path) -> bool:
    path_str = str(path)
    return any(pattern.search(path_str) for pattern in ALLOWED_PATHS)


def check_file(path: Path) -> list[str]:
    if is_excluded(path):
        return []

    try:
        text = path.read_text(encoding="utf-8", errors="ignore")
    except (OSError, PermissionError) as exc:
        return [f"{path}: could not read file — {exc}"]

    violations: list[str] = []
    for line_num, line in enumerate(text.splitlines(), start=1):
        for term_name, pattern in FORBIDDEN_TERMS:
            if pattern.search(line):
                violations.append(
                    f"{path}:{line_num}: forbidden term '{term_name}' — "
                    f"use 'historical average X over period Y' instead.\n"
                    f"  {line.strip()}"
                )

    return violations


def main(argv: list[str]) -> int:
    if not argv:
        return 0

    all_violations: list[str] = []
    for arg in argv:
        path = Path(arg)
        if path.is_file():
            all_violations.extend(check_file(path))

    if all_violations:
        print("FORECASTING-TERM LINTER: violations found\n", file=sys.stderr)
        for violation in all_violations:
            print(violation, file=sys.stderr)
        print(
            "\nFix: replace predictive/forecasting language with "
            "'historical average X over period Y' (window stated).",
            file=sys.stderr,
        )
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
