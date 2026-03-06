import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const serverPath = join(root, "dist", "index.js");
const fixturesDir = join(root, "test", "fixtures");

interface McpResponse {
  jsonrpc: string;
  id: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

function startServer(): ReturnType<typeof spawn> {
  return spawn("node", [
    serverPath,
    "--name", "test-server",
    "--description", "Test schemas for e-commerce",
    fixturesDir,
  ], {
    stdio: ["pipe", "pipe", "pipe"],
  });
}

async function mcpSession(requests: object[]): Promise<McpResponse[]> {
  const proc = startServer();
  const responses: McpResponse[] = [];
  // init response + one per request
  const expectedCount = 1 + requests.length;

  return new Promise((resolve, reject) => {
    let buffer = "";
    const timeout = setTimeout(() => {
      proc.kill();
      reject(new Error(`Timeout waiting for responses. Got ${responses.length}/${expectedCount}`));
    }, 5000);

    function checkDone() {
      if (responses.length >= expectedCount) {
        clearTimeout(timeout);
        proc.kill();
        resolve(responses);
      }
    }

    proc.stdout!.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop()!;
      for (const line of lines) {
        if (line.trim()) {
          responses.push(JSON.parse(line));
          checkDone();
        }
      }
    });

    proc.on("error", (e) => { clearTimeout(timeout); reject(e); });

    const init = {
      jsonrpc: "2.0",
      id: 0,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test", version: "0.1" },
      },
    };
    const notify = { jsonrpc: "2.0", method: "notifications/initialized", params: {} };

    proc.stdin!.write(JSON.stringify(init) + "\n");
    proc.stdin!.write(JSON.stringify(notify) + "\n");
    for (const req of requests) {
      proc.stdin!.write(JSON.stringify(req) + "\n");
    }
  });
}

function callTool(id: number, name: string, args: Record<string, string> = {}) {
  return { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } };
}

function parseContent(response: McpResponse): unknown {
  const content = response.result?.content as Array<{ type: string; text: string }>;
  return JSON.parse(content[0].text);
}

describe("MCP server integration", () => {
  it("reports configured server name on init", async () => {
    const responses = await mcpSession([]);
    const serverInfo = responses[0].result?.serverInfo as { name: string } | undefined;
    expect(serverInfo?.name).toBe("test-server");
  });

  it("list_schemas returns both schemas", async () => {
    const responses = await mcpSession([callTool(1, "list_schemas")]);
    const result = parseContent(responses[1]) as Array<{ name: string; definitionCount: number }>;
    const names = result.map((s) => s.name).sort();
    expect(names).toEqual(["order", "user"]);
    expect(result.find((s) => s.name === "order")!.definitionCount).toBe(3);
    expect(result.find((s) => s.name === "user")!.definitionCount).toBe(3);
  });

  it("list_definitions returns definition summaries", async () => {
    const responses = await mcpSession([callTool(1, "list_definitions", { schema: "order" })]);
    const result = parseContent(responses[1]) as Array<{ name: string; title: string | null }>;
    const names = result.map((d) => d.name).sort();
    expect(names).toEqual(["Address", "LineItem", "Order"]);
    expect(result.find((d) => d.name === "Address")!.title).toBe("Postal Address");
  });

  it("get_definition returns full schema", async () => {
    const responses = await mcpSession([
      callTool(1, "get_definition", { schema: "order", definition: "LineItem" }),
    ]);
    const result = parseContent(responses[1]) as Record<string, unknown>;
    expect(result.type).toBe("object");
    expect((result.properties as Record<string, unknown>).productId).toBeTruthy();
  });

  it("get_definition returns error for missing definition", async () => {
    const responses = await mcpSession([
      callTool(1, "get_definition", { schema: "order", definition: "Nope" }),
    ]);
    expect((responses[1].result as Record<string, unknown>).isError).toBe(true);
  });

  it("search_definitions finds within a schema", async () => {
    const responses = await mcpSession([
      callTool(1, "search_definitions", { schema: "user", keyword: "email" }),
    ]);
    const result = parseContent(responses[1]) as Array<{ definition: string }>;
    const defs = result.map((h) => h.definition);
    expect(defs).toContain("User");
  });

  it("search_all finds across schemas", async () => {
    const responses = await mcpSession([callTool(1, "search_all", { keyword: "address" })]);
    const result = parseContent(responses[1]) as Array<{ schema: string; definition: string }>;
    const schemaNames = [...new Set(result.map((h) => h.schema))].sort();
    // "address" appears in both schemas
    expect(schemaNames).toContain("order");
    expect(schemaNames).toContain("user");
  });

  it("returns error for unknown schema", async () => {
    const responses = await mcpSession([
      callTool(1, "list_definitions", { schema: "nonexistent" }),
    ]);
    expect((responses[1].result as Record<string, unknown>).isError).toBe(true);
  });
});
