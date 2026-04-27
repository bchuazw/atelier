"""Console entry point: `python -m mcp_server` runs the stdio MCP server."""

from .server import run_stdio


def main() -> None:
    run_stdio()


if __name__ == "__main__":
    main()
