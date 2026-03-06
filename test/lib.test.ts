import { describe, it, expect } from "vitest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { indexSchemas, searchInSchema, matchesKeyword } from "../src/lib.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

describe("indexSchemas", () => {
  it("indexes both $defs and definitions", async () => {
    const schemas = await indexSchemas(fixturesDir);
    expect(schemas.size).toBe(2);
    expect(schemas.has("order")).toBe(true);
    expect(schemas.has("user")).toBe(true);
  });

  it("extracts $defs from order schema", async () => {
    const schemas = await indexSchemas(fixturesDir);
    const order = schemas.get("order")!;
    expect(order.definitions.size).toBe(3);
    expect(order.definitions.has("Address")).toBe(true);
    expect(order.definitions.has("LineItem")).toBe(true);
    expect(order.definitions.has("Order")).toBe(true);
  });

  it("extracts definitions from user schema", async () => {
    const schemas = await indexSchemas(fixturesDir);
    const user = schemas.get("user")!;
    expect(user.definitions.size).toBe(3);
    expect(user.definitions.has("User")).toBe(true);
    expect(user.definitions.has("UserAddress")).toBe(true);
    expect(user.definitions.has("Preferences")).toBe(true);
  });

  it("captures title and description", async () => {
    const schemas = await indexSchemas(fixturesDir);
    const order = schemas.get("order")!;
    expect(order.title).toBe("Order Schema");
    expect(order.description).toBe("Schema for e-commerce orders");
  });
});

describe("matchesKeyword", () => {
  it("matches strings case-insensitively", () => {
    expect(matchesKeyword("Hello World", "hello")).toBe(true);
    expect(matchesKeyword("Hello World", "goodbye")).toBe(false);
  });

  it("searches nested objects", () => {
    expect(matchesKeyword({ a: { b: "needle" } }, "needle")).toBe(true);
    expect(matchesKeyword({ a: { b: "hay" } }, "needle")).toBe(false);
  });

  it("searches arrays", () => {
    expect(matchesKeyword(["one", "two"], "two")).toBe(true);
  });

  it("handles non-string primitives", () => {
    expect(matchesKeyword(42, "42")).toBe(false);
    expect(matchesKeyword(null, "null")).toBe(false);
  });
});

describe("searchInSchema", () => {
  it("finds definitions by name", async () => {
    const schemas = await indexSchemas(fixturesDir);
    const hits = searchInSchema(schemas.get("order")!, "order", "address");
    const names = hits.map((h) => h.definition);
    expect(names).toContain("Address");
    // Order also references address in its properties
    expect(names).toContain("Order");
  });

  it("finds definitions by property content", async () => {
    const schemas = await indexSchemas(fixturesDir);
    const hits = searchInSchema(schemas.get("user")!, "user", "email");
    const names = hits.map((h) => h.definition);
    expect(names).toContain("User");
    // Preferences has emailNotifications
    expect(names).toContain("Preferences");
  });

  it("returns empty for no matches", async () => {
    const schemas = await indexSchemas(fixturesDir);
    const hits = searchInSchema(schemas.get("order")!, "order", "zzzznothing");
    expect(hits.length).toBe(0);
  });
});
