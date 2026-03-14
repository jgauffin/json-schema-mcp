# Relax! MCP, Json Schema

MCP server that indexes JSON Schema and OpenAPI files and exposes their definitions as browsable, searchable tools for AI agents.

## Why not just read the file?

Large schema and OpenAPI files can be thousands of lines. Dumping them into context wastes tokens and drowns the signal in noise. This server lets the agent explore schemas surgically.

| | Without this server | With this server |
|---|---|---|
| **Context cost** | Entire file loaded into context (thousands of tokens) | Agent fetches only the definitions it needs |
| **Discovery** | Agent must parse raw JSON to find what's available | `list_schemas` → `list_definitions` → `get_definition` |
| **Search** | Manual scanning or regex on raw text | Keyword, glob, and pipe search across all schemas |
| **OpenAPI** | Agent must understand the spec structure to find schemas and operations | Schemas and operations are extracted and indexed automatically |
| **Multiple sources** | Agent reads each file individually | One server merges directories and URLs into a single index |

## Features

- **Auto-detects** JSON Schema, OpenAPI 3.x, and Swagger 2.0
- **OpenAPI support** indexes both component schemas and path operations (e.g. `GET /pets`)
- **Multiple sources** — pass any mix of local directories and HTTP(S) URLs, merged into one index
- **Glob & pipe search** — use `*`, `?` wildcards and `|` as OR separator

One server, one set of tools, all schemas in one place — no confusion from duplicate tool names across servers.

## Tools

| Tool | Description |
|---|---|
| `list_schemas` | List all indexed schema files with format, titles, and definition counts |
| `list_definitions` | List definition names in a schema (includes OpenAPI operations) |
| `get_definition` | Get the full JSON schema of a definition or OpenAPI operation |
| `search_definitions` | Search definitions by keyword/glob/pipe within a schema |
| `search_all` | Search definitions by keyword/glob/pipe across all schemas |

### Search syntax

| Pattern | Meaning |
|---|---|
| `address` | Substring match (case-insensitive) |
| `GET*` | Glob — matches definitions starting with "GET" |
| `*Id` | Glob — matches definitions ending with "Id" |
| `user\|account` | Pipe — matches either "user" or "account" |
| `GET*\|POST*` | Combined — matches GET or POST operations |

## Build

```bash
npm install
npm run build
```

## Run

```bash
json-schema-mcp [options] <source...>

  Each <source> can be a local directory or an HTTP(S) URL.
  Multiple sources are merged into a single index.
  JSON Schema and OpenAPI (3.x / Swagger 2.0) files are auto-detected.

Options:
  -n, --name <name>            Server name shown to the agent (default: json-schema-mcp)
  -d, --description <text>     What these schemas are for (prefixed to tool descriptions)
  -h, --help                   Show help
```

Examples:

```bash
# Single local directory
json-schema-mcp --name "order-api" ./schemas/orders

# Multiple sources: local dirs + remote specs
json-schema-mcp --name "all-apis" \
  ./schemas/orders \
  ./schemas/users \
  https://petstore3.swagger.io/api/v3/openapi.json
```

## Configure with Claude Code

Add to `.mcp.json` in your project root. One server handles all your schema sources:

```json
{
  "mcpServers": {
    "schemas": {
      "command": "node",
      "args": [
        "/path/to/dist/index.js",
        "--name", "api-schemas",
        "--description", "All API schemas (orders, users, petstore)",
        "/path/to/schemas/orders",
        "/path/to/schemas/users",
        "https://petstore3.swagger.io/api/v3/openapi.json"
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
npx @modelcontextprotocol/inspector node dist/index.js --name "debug" ./schemas
```

Opens a web UI where you can call each tool interactively.

### Node.js debugger

```bash
node --inspect-brk dist/index.js --name "debug" ./schemas
```

Attach with Chrome DevTools (`chrome://inspect`) or VS Code. Since the server communicates over stdio, pipe MCP messages manually or use the inspector as the client.

### Verbose logging

The server logs to stderr (e.g. skipped files). Redirect to see diagnostics:

```bash
echo '...' | node dist/index.js ./schemas 2>debug.log
```
