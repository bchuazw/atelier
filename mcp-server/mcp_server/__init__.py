"""Atelier MCP server.

Exposes the Atelier API (https://atelier-api-wpx8.onrender.com/api/v1 by
default) as a Model Context Protocol tool surface for Claude Code's builder
agent. See README.md for the use case + installation.
"""

from .server import build_server, run_stdio

__all__ = ["build_server", "run_stdio"]
