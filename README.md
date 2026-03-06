# Relax! MCP, Json Schema

MCP server that indexes JSON schema files and exposes their definitions (`$defs` / `definitions`) as browsable, searchable tools for AI agents.

Use `--name` and `--description` to run multiple instances for different schema sets, so the agent knows what each one is for.

## Tools

| Tool | Description |
|---|---|
| `list_schemas` | List all indexed schema files with titles and definition counts |
| `list_definitions` | List definition names in a specific schema |
| `get_definition` | Get the full JSON schema of a specific definition |
| `search_definitions` | Search definitions by keyword within a schema |
| `search_all` | Search definitions by keyword across all schemas |

## Build

```bash
npm install
npm run build
```

## Run

```bash
json-schema-mcp [options] <schemas-directory>

Options:
  -n, --name <name>            Server name shown to the agent (default: json-schema-mcp)
  -d, --description <text>     What these schemas are for (prefixed to tool descriptions)
  -h, --help                   Show help
```

Example:

```bash
node dist/src/index.js --name "order-api" --description "Order management REST API" ./schemas/orders
```

## Configure with Claude Code

Add to `.mcp.json` in your project root. You can run multiple instances for different schema sets:

```json
{
  "mcpServers": {
    "order-schemas": {
      "command": "node",
      "args": [
        "/path/to/dist/src/index.js",
        "--name", "order-api",
        "--description", "Order management API schemas",
        "/path/to/schemas/orders"
      ]
    },
    "user-schemas": {
      "command": "node",
      "args": [
        "/path/to/dist/src/index.js",
        "--name", "user-api",
        "--description", "User account and auth schemas",
        "/path/to/schemas/users"
      ]
    }
  }
}
```

## Configure with Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "my-schemas": {
      "command": "node",
      "args": [
        "/absolute/path/to/dist/src/index.js",
        "--name", "my-api",
        "--description", "My API schemas",
        "/absolute/path/to/schemas"
      ]
    }
  }
}
```

## Test

```bash
npm test
```

Runs unit tests (indexing, search logic) and integration tests (full MCP protocol over stdio).

## Debug

### Inspect with MCP Inspector

```bash
npx @modelcontextprotocol/inspector node dist/src/index.js --name "debug" ./schemas
```

Opens a web UI where you can call each tool interactively.

### Node.js debugger

```bash
node --inspect-brk dist/src/index.js --name "debug" ./schemas
```

Attach with Chrome DevTools (`chrome://inspect`) or VS Code. Since the server communicates over stdio, pipe MCP messages manually or use the inspector as the client.

### Verbose logging

The server logs to stderr (e.g. skipped files). Redirect to see diagnostics:

```bash
echo '...' | node dist/src/index.js ./schemas 2>debug.log
```
