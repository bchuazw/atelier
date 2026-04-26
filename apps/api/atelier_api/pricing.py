"""Per-1M token pricing tiers (USD), mirroring the client-side
`VariantCostPill` constants in `apps/web/src/components/VariantNode.tsx`.

Centralized here so the project cost rollup (`/projects/{id}/tree`) and the
soft-cap enforcement in `routes/fork.py` agree to-the-cent with what the
user sees on each variant card. Any change here MUST be mirrored in
VariantNode.tsx (and TopBar.tsx if it diverges from session-cost rates).
"""

from __future__ import annotations

# Per-1M-token rates, USD. cr = cache_read, cw = cache_creation.
PRICING_TIERS: dict[str, dict[str, float]] = {
    "haiku": {"i": 0.25, "o": 1.25, "cr": 0.025, "cw": 0.3},
    "sonnet": {"i": 3.0, "o": 15.0, "cr": 0.3, "cw": 3.75},
    "opus": {"i": 15.0, "o": 75.0, "cr": 1.5, "cw": 18.75},
}


def _tier_for_model(model: str | None) -> dict[str, float]:
    """Pick the pricing tier from the (possibly fully-qualified) model id.
    Defaults to Sonnet rates when the model is unknown so cost is never
    silently zero."""
    m = (model or "").lower()
    if "haiku" in m:
        return PRICING_TIERS["haiku"]
    if "opus" in m:
        return PRICING_TIERS["opus"]
    return PRICING_TIERS["sonnet"]


def cost_cents_for_usage(usage: dict | None, model: str | None) -> int:
    """USD cents (rounded) for one node's token_usage payload. Returns 0
    for missing/empty usage so seed nodes contribute nothing to the rollup."""
    if not usage:
        return 0
    tier = _tier_for_model(model)
    input_tok = int(usage.get("input") or 0)
    output_tok = int(usage.get("output") or 0)
    cache_read = int(usage.get("cache_read") or 0)
    cache_creation = int(usage.get("cache_creation") or 0)
    if input_tok + output_tok + cache_read + cache_creation == 0:
        return 0
    cost_usd = (
        input_tok * tier["i"]
        + output_tok * tier["o"]
        + cache_read * tier["cr"]
        + cache_creation * tier["cw"]
    ) / 1_000_000
    # Round to nearest cent. Sub-cent rolls to 0; that's fine for the rollup.
    return int(round(cost_usd * 100))


def cost_events_total_cents(events: list[dict] | None) -> int:
    """Sum the `cost_cents` field across project-level cost events (currently
    only React-export, which doesn't persist a Node).

    Pure function — no DB access — so callers can decide where the event list
    comes from (typically `project.settings.get("cost_events")`). Malformed
    entries (non-dict, missing/non-numeric `cost_cents`) are silently skipped
    so a single bad row never poisons the rollup."""
    if not events:
        return 0
    total = 0
    for ev in events:
        if not isinstance(ev, dict):
            continue
        raw = ev.get("cost_cents")
        if isinstance(raw, bool):
            # bool is an int subclass in Python — guard explicitly.
            continue
        if not isinstance(raw, (int, float)):
            continue
        total += int(raw)
    return total


def project_total_cost_cents(nodes: list, project=None) -> int:
    """Sum cost across every node with a token_usage payload, plus any
    project-level `cost_events` (e.g. React export, which doesn't persist a
    Node). `nodes` is the SQLAlchemy Node iterable; only `model_used` +
    `token_usage` are read so this is safe to call after a normal
    `select(Node)` fetch.

    `project` is optional for backwards compat — when omitted, the rollup is
    node-only (matches the pre-cost_events behavior). When passed, its
    `settings["cost_events"]` list is folded in via `cost_events_total_cents`.
    """
    total = 0
    for n in nodes:
        total += cost_cents_for_usage(getattr(n, "token_usage", None), getattr(n, "model_used", None))
    if project is not None:
        proj_settings = getattr(project, "settings", None) or {}
        events = proj_settings.get("cost_events") if isinstance(proj_settings, dict) else None
        total += cost_events_total_cents(events)
    return total
