# Convenience targets for the Atelier MCP server.
# Run from inside mcp-server/ (or `make -C mcp-server <target>` from repo root).

.PHONY: install run smoke list-tools

install:
	pip install -r requirements.txt

# Boot the stdio MCP server. Override the backend with:
#   ATELIER_API_BASE=http://localhost:8000/api/v1 make run
run:
	python -m mcp_server

# Hit the live Atelier API with the read-only tools (free of charge).
smoke:
	python smoke_test.py

# Pipe a tools/list JSON-RPC request and print the server's response.
# Useful as a self-contained "did all 8 tools register?" check.
list-tools:
	@echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | python -m mcp_server
