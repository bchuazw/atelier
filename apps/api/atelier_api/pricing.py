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


def project_total_cost_cents(nodes: list) -> int:
    """Sum cost across every node with a token_usage payload. `nodes` is the
    SQLAlchemy Node iterable; only `model_used` + `token_usage` are read so
    this is safe to call after a normal `select(Node)` fetch."""
    total = 0
    for n in nodes:
        total += cost_cents_for_usage(getattr(n, "token_usage", None), getattr(n, "model_used", None))
    return total
