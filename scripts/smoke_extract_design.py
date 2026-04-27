"""Smoke test for POST /api/v1/projects/extract-design.

Run the API locally (`uvicorn atelier_api.main:app --reload --port 8000`),
then `python scripts/smoke_extract_design.py`. Requires ANTHROPIC_API_KEY.
"""
import json
import urllib.request

req = urllib.request.Request(
    "http://localhost:8000/api/v1/projects/extract-design",
    data=json.dumps({"url": "https://stripe.com"}).encode(),
    headers={"Content-Type": "application/json"},
    method="POST",
)
body = json.loads(urllib.request.urlopen(req, timeout=120).read().decode())
assert {"summary", "style_pins", "seed_html", "model_used", "token_usage", "cost_cents"} <= body.keys()
assert any(p["kind"] == "color" for p in body["style_pins"]), "no color pin"
assert any(p["kind"] == "font" for p in body["style_pins"]), "no font pin"
print("OK", {k: (type(v).__name__, len(v) if hasattr(v, "__len__") else v) for k, v in body.items()})
