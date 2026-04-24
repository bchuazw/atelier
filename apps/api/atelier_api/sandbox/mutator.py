from __future__ import annotations

import shutil
from pathlib import Path


def clone_tree(src: Path, dst: Path) -> None:
    """Copy a variant's source tree to a fresh directory. Used when forking."""
    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(src, dst)


def apply_html_override(variant_dir: Path, new_html: str) -> None:
    """Replace index.html with a new full-HTML document.

    Images, stylesheets, and other assets referenced by the parent are preserved
    under variant_dir/assets/ so relative references in the new HTML keep working.
    """
    index = variant_dir / "index.html"
    index.write_text(new_html, encoding="utf-8")


def apply_style_override(variant_dir: Path, extra_css: str) -> None:
    """Append a stylesheet override without touching the document structure.

    Useful for small visual variants where the LLM returns just CSS rules.
    """
    index = variant_dir / "index.html"
    html = index.read_text(encoding="utf-8")
    override = f'\n<style data-atelier-override>\n{extra_css}\n</style>\n'
    if "</head>" in html:
        html = html.replace("</head>", f"{override}</head>", 1)
    else:
        html = override + html
    index.write_text(html, encoding="utf-8")
