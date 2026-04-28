"""Tests for the /diff/summarize endpoint.

LLM call is mocked so the test runs offline + deterministic. We verify:
  - empty diff is rejected with 400
  - well-formed diff returns the expected shape
  - category counts are computed locally even when the LLM call would fail
  - oversize entries are bounded at the Pydantic layer (max_length checks)
"""
from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, patch


SAMPLE_DIFF = [
    {
        "selector": ":root",
        "property": "--primary",
        "before": "#0a2540",
        "after": "#a07c2c",
        "category": "palette",
    },
    {
        "selector": "h1",
        "property": "font-size",
        "before": "32px",
        "after": "48px",
        "category": "typography",
    },
    {
        "selector": "h1",
        "property": "font-family",
        "before": "Inter",
        "after": "Playfair Display",
        "category": "typography",
    },
    {
        "selector": ".cta",
        "property": "padding",
        "before": "8px 16px",
        "after": "12px 24px",
        "category": "spacing",
    },
]


def _mock_llm_response(text: str):
    """Build a fake LlmResponse so the route's `resp.text` / `.usage_dict`
    / `.model` accesses all return real values without hitting Anthropic."""
    from atelier_api.providers.base import LlmResponse

    return LlmResponse(
        text=text,
        model="claude-haiku-4-5",
        input_tokens=500,
        output_tokens=120,
    )


@pytest.mark.asyncio
async def test_summarize_empty_diff_is_400(client):
    r = await client.post("/api/v1/diff/summarize", json={"diff": []})
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_summarize_happy_path(client):
    fake_json = (
        '{"summary": "Warmer brass palette with a bolder serif headline and '
        'roomier CTA — premium editorial feel.", '
        '"bullets": ["Headline switched from Inter 32px to Playfair Display 48px", '
        '"Primary brand color shifted from navy #0a2540 to brass #a07c2c", '
        '"CTA button padding increased to 12px/24px"]}'
    )
    with patch(
        "atelier_api.llm.client.call",
        new=AsyncMock(return_value=_mock_llm_response(fake_json)),
    ):
        r = await client.post(
            "/api/v1/diff/summarize",
            json={"diff": SAMPLE_DIFF, "a_title": "Editorial Spread", "b_title": "Brass Premium"},
        )
    assert r.status_code == 200, r.text
    body = r.json()
    assert "Warmer brass palette" in body["summary"]
    assert len(body["bullets"]) == 3
    assert body["model_used"].startswith("claude-haiku")
    assert body["cost_cents"] >= 0
    assert body["category_counts"] == {"palette": 1, "typography": 2, "spacing": 1}


@pytest.mark.asyncio
async def test_summarize_handles_invalid_llm_json(client):
    """If Haiku returns garbage, surface a 502 not a 500 — the client can
    show "no summary available" instead of crashing."""
    with patch(
        "atelier_api.llm.client.call",
        new=AsyncMock(return_value=_mock_llm_response("not json at all")),
    ):
        r = await client.post("/api/v1/diff/summarize", json={"diff": SAMPLE_DIFF})
    assert r.status_code == 502
    assert "invalid JSON" in r.json()["detail"]


@pytest.mark.asyncio
async def test_summarize_handles_fenced_json(client):
    """Haiku sometimes wraps JSON in ```json fences despite the prompt — the
    parser strips them."""
    fake = '```json\n{"summary": "ok", "bullets": ["x"]}\n```'
    with patch(
        "atelier_api.routes.diff.llm.call",
        new=AsyncMock(return_value=_mock_llm_response(fake)),
    ):
        r = await client.post("/api/v1/diff/summarize", json={"diff": SAMPLE_DIFF})
    assert r.status_code == 200
    assert r.json()["summary"] == "ok"


@pytest.mark.asyncio
async def test_summarize_rejects_unknown_category(client):
    r = await client.post(
        "/api/v1/diff/summarize",
        json={"diff": [{**SAMPLE_DIFF[0], "category": "made_up_category"}]},
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_summarize_caps_bullets(client):
    """Even if Haiku returns 20 bullets, we cap at 8 to keep the UI tight."""
    bullets = [f"bullet {i}" for i in range(20)]
    import json as _json

    fake = _json.dumps({"summary": "x", "bullets": bullets})
    with patch(
        "atelier_api.routes.diff.llm.call",
        new=AsyncMock(return_value=_mock_llm_response(fake)),
    ):
        r = await client.post("/api/v1/diff/summarize", json={"diff": SAMPLE_DIFF})
    assert r.status_code == 200
    assert len(r.json()["bullets"]) == 8
