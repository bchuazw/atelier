"""Smoke test for diff.py — runs the StyleDiff engine on a hand-crafted
pair of HTML snippets and asserts at least one entry per touched category.
"""

from __future__ import annotations

import json
from mcp_server.diff import compute_style_diff, summarize


BEFORE = """
<!doctype html>
<html><head><style>
  :root { --brand: #0066ff; --radius: 4px; }
  .hero { color: var(--brand); font-size: 32px; padding: 16px; }
  .cta  { background: #fff; border-radius: var(--radius); }
</style></head>
<body>
  <h1>Welcome to Atelier</h1>
  <p>Explore design variants in parallel.</p>
  <button>Get started</button>
</body></html>
"""

AFTER = """
<!doctype html>
<html><head><style>
  :root { --brand: #ff3366; --radius: 4px; }
  .hero { color: var(--brand); font-size: 48px; padding: 16px; }
  .cta  { background: #fff; border-radius: var(--radius); }
</style></head>
<body>
  <h1>Welcome to Atelier</h1>
  <p>Explore design variants in parallel — together.</p>
  <button>Get started</button>
  <a href="#">Learn more</a>
</body></html>
"""


def main() -> None:
    diff = compute_style_diff(BEFORE, AFTER)
    summary = summarize(diff)
    print("Summary:", json.dumps(summary, indent=2))
    print("Full diff:")
    for d in diff:
        print(" ", json.dumps(d, ensure_ascii=False))
    # Touched categories: copy (rewrote p, added a), tokens (--brand
    # changed), typography (font-size), structure (added <a>).
    assert summary["copy"] >= 1, "expected at least one copy diff"
    assert summary["tokens"] >= 1, "expected at least one token diff"
    assert summary["typography"] >= 1, "expected at least one typography diff"
    assert summary["structure"] >= 1, "expected at least one structure diff"
    print("OK: all asserted categories present")


if __name__ == "__main__":
    main()
