from __future__ import annotations

import asyncio
import re
from pathlib import Path
from urllib.parse import urljoin, urlparse

import httpx
from bs4 import BeautifulSoup

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Atelier/0.1"
)

TIMEOUT = httpx.Timeout(20.0, connect=10.0)


async def _fetch(client: httpx.AsyncClient, url: str) -> bytes | None:
    try:
        r = await client.get(url, follow_redirects=True)
        if r.status_code == 200:
            return r.content
    except Exception:
        return None
    return None


async def fetch_page(url: str, out_dir: Path) -> Path:
    """Fetch an HTML page with inlined/downloaded assets into out_dir.

    Returns the path to the produced index.html. Relative-URL assets are
    downloaded to out_dir/assets/ and the HTML is rewritten to point at them.
    External fonts/scripts that fail to fetch are left as absolute URLs.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "assets").mkdir(exist_ok=True)

    async with httpx.AsyncClient(
        headers={"User-Agent": USER_AGENT},
        timeout=TIMEOUT,
        follow_redirects=True,
    ) as client:
        r = await client.get(url)
        r.raise_for_status()
        html = r.text
        base = str(r.url)

        soup = BeautifulSoup(html, "lxml")

        # Drop any <base> tag. In our sandbox model we rewrite all assets to
        # local paths under variants/<id>/, so a <base href="https://..."> would
        # hijack relative URLs (e.g., hero image at `media/hero.jpg` resolves
        # to `https://originalsite.com/media/hero.jpg`) and break rendering.
        for existing_base in soup.find_all("base"):
            existing_base.decompose()

        # Download images + stylesheets; rewrite to local paths.
        tasks: list[tuple[BeautifulSoup, str, str]] = []  # (element, attr, absolute_url)

        for img in soup.find_all("img"):
            src = img.get("src")
            if src:
                tasks.append((img, "src", urljoin(base, src)))
            srcset = img.get("srcset")
            if srcset:
                # drop srcset to keep it simple for the hackathon MVP
                del img["srcset"]

        for link in soup.find_all("link", rel=lambda v: v and "stylesheet" in v):
            href = link.get("href")
            if href:
                tasks.append((link, "href", urljoin(base, href)))

        # Fetch assets in parallel.
        results = await asyncio.gather(*(_fetch(client, u) for (_, _, u) in tasks))

        for (el, attr, abs_url), data in zip(tasks, results):
            if data is None:
                el[attr] = abs_url  # leave as absolute so browser still fetches it
                continue
            parsed = urlparse(abs_url)
            name = Path(parsed.path).name or "asset"
            safe = re.sub(r"[^a-zA-Z0-9._-]", "_", name)[:80]
            # ensure uniqueness
            target = out_dir / "assets" / safe
            i = 1
            while target.exists():
                target = out_dir / "assets" / f"{i}_{safe}"
                i += 1
            target.write_bytes(data)
            el[attr] = f"assets/{target.name}"

        # Strip <script> tags that are likely analytics / heavy frameworks to keep the
        # hackathon demo lightweight. Keep inline non-empty scripts (usually app logic).
        for s in soup.find_all("script"):
            src = s.get("src") or ""
            if any(bad in src.lower() for bad in ("googletagmanager", "analytics", "hotjar", "segment")):
                s.decompose()

    index = out_dir / "index.html"
    index.write_text(str(soup), encoding="utf-8")
    return index
