# @workflow-miner/mcp

Stdio MCP server for the [Workflow Miner](https://github.com/iamgagan/workflow-miner) Company Brain. Exposes your company's brain to any MCP-compatible client (Claude Code, Cursor, etc.) so you can search, fetch pages, list patterns, and trigger workflows from your editor.

## Install

In your MCP client config (e.g. `~/.claude/settings.json`):

```jsonc
{
  "mcpServers": {
    "company-brain": {
      "command": "npx",
      "args": ["-y", "@workflow-miner/mcp"],
      "env": {
        "WM_URL": "https://brain.your-company.com",
        "WM_API_KEY": "wmk_<generate one in /settings/api-keys>"
      }
    }
  }
}
```

## Tools exposed

| Tool | What it does |
|---|---|
| `search_brain` | Vector search over pages + timeline (`POST /api/mcp/search`) |
| `get_page` | Fetch a single brain page by slug (`GET /api/mcp/page/:slug`) |
| `list_recent_activity` | Recent timeline entries, optionally filtered by source |
| `list_patterns` | Detected workflow patterns |
| `trigger_workflow` | Execute a pattern by id or slug |

## License

Private — All rights reserved.
