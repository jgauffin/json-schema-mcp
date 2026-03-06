#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { indexSchemas, searchInSchema, type SearchHit } from "./lib.js";

// --- CLI args ---

interface CliArgs {
  name: string;
  description: string;
  schemasDir: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  let name = "json-schema-mcp";
  let description = "";
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if ((args[i] === "--name" || args[i] === "-n") && i + 1 < args.length) {
      name = args[++i];
    } else if ((args[i] === "--description" || args[i] === "-d") && i + 1 < args.length) {
      description = args[++i];
    } else if (args[i] === "--help" || args[i] === "-h") {
      console.error(USAGE);
      process.exit(0);
    } else if (!args[i].startsWith("-")) {
      positional.push(args[i]);
    } else {
      console.error(`Unknown option: ${args[i]}\n`);
      console.error(USAGE);
      process.exit(1);
    }
  }

  if (positional.length !== 1) {
    console.error(USAGE);
    process.exit(1);
  }

  return { name, description, schemasDir: positional[0] };
}

const USAGE = `Usage: json-schema-mcp [options] <schemas-directory>

Options:
  -n, --name <name>            Server name shown to the agent
  -d, --description <text>     What these schemas are for
  -h, --help                   Show this help`;

// --- Server setup ---

const cli = parseArgs(process.argv);
const schemas = await indexSchemas(cli.schemasDir);

// Prefix tool descriptions with context when provided
const ctx = cli.description ? `[${cli.description}] ` : "";

const server = new McpServer({
  name: cli.name,
  version: "1.0.0",
});

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function err(msg: string) {
  return { content: [{ type: "text" as const, text: msg }], isError: true as const };
}

server.registerTool("list_schemas", {
  description: `${ctx}List all indexed JSON schema files with their titles and definition counts`,
}, () => {
  const items = [...schemas.entries()].map(([name, s]) => ({
    name,
    filename: s.filename,
    title: s.title ?? null,
    description: s.description ?? null,
    definitionCount: s.definitions.size,
  }));
  return ok(items);
});

const schemaParam = { schema: z.string().describe("Schema name (filename without .json)") };

server.registerTool("list_definitions", {
  description: `${ctx}List all definition names in a specific schema`,
  inputSchema: schemaParam,
}, ({ schema: schemaName }) => {
  const s = schemas.get(schemaName);
  if (!s) return err(`Schema "${schemaName}" not found`);
  const defs = [...s.definitions.entries()].map(([name, def]) => ({
    name,
    title: (def.title as string) ?? null,
    description: (def.description as string) ?? null,
  }));
  return ok(defs);
});

server.registerTool("get_definition", {
  description: `${ctx}Get the full JSON schema of a specific definition`,
  inputSchema: {
    schema: z.string().describe("Schema name (filename without .json)"),
    definition: z.string().describe("Definition name"),
  },
}, ({ schema: schemaName, definition }) => {
  const s = schemas.get(schemaName);
  if (!s) return err(`Schema "${schemaName}" not found`);
  const def = s.definitions.get(definition);
  if (!def) return err(`Definition "${definition}" not found in "${schemaName}"`);
  return ok(def);
});

server.registerTool("search_definitions", {
  description: `${ctx}Search definitions by keyword within a specific schema`,
  inputSchema: {
    schema: z.string().describe("Schema name (filename without .json)"),
    keyword: z.string().describe("Search keyword"),
  },
}, ({ schema: schemaName, keyword }) => {
  const s = schemas.get(schemaName);
  if (!s) return err(`Schema "${schemaName}" not found`);
  return ok(searchInSchema(s, schemaName, keyword));
});

server.registerTool("search_all", {
  description: `${ctx}Search definitions by keyword across all schemas`,
  inputSchema: { keyword: z.string().describe("Search keyword") },
}, ({ keyword }) => {
  const hits: SearchHit[] = [];
  for (const [name, s] of schemas) {
    hits.push(...searchInSchema(s, name, keyword));
  }
  return ok(hits);
});

const transport = new StdioServerTransport();
await server.connect(transport);
