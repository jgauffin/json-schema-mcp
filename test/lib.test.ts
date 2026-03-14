import { describe, it, expect } from "vitest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  indexDirectory,
  indexSchemas,
  searchInSchema,
  matchesKeyword,
  detectFormat,
  buildMatcher,
} from "../src/lib.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

describe("indexSchemas", () => {
  it("indexes both $defs and definitions", async () => {
    const schemas = await indexSchemas(fixturesDir);
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

describe("detectFormat", () => {
  it("detects OpenAPI 3.x", () => {
    expect(detectFormat({ openapi: "3.0.3" })).toBe("openapi-3");
    expect(detectFormat({ openapi: "3.1.0" })).toBe("openapi-3");
  });

  it("detects Swagger 2.0", () => {
    expect(detectFormat({ swagger: "2.0" })).toBe("swagger-2");
  });

  it("defaults to json-schema", () => {
    expect(detectFormat({ type: "object" })).toBe("json-schema");
    expect(detectFormat({})).toBe("json-schema");
  });
});

describe("OpenAPI indexing", () => {
  it("detects petstore as openapi-3", async () => {
    const schemas = await indexDirectory(fixturesDir);
    const petstore = schemas.get("petstore")!;
    expect(petstore.format).toBe("openapi-3");
  });

  it("extracts title and description from info", async () => {
    const schemas = await indexDirectory(fixturesDir);
    const petstore = schemas.get("petstore")!;
    expect(petstore.title).toBe("Petstore API");
    expect(petstore.description).toBe("A sample pet store API");
  });

  it("extracts component schemas", async () => {
    const schemas = await indexDirectory(fixturesDir);
    const petstore = schemas.get("petstore")!;
    expect(petstore.definitions.has("Pet")).toBe(true);
    expect(petstore.definitions.has("Error")).toBe(true);
  });

  it("extracts path operations", async () => {
    const schemas = await indexDirectory(fixturesDir);
    const petstore = schemas.get("petstore")!;
    expect(petstore.definitions.has("GET /pets")).toBe(true);
    expect(petstore.definitions.has("POST /pets")).toBe(true);
    expect(petstore.definitions.has("GET /pets/{petId}")).toBe(true);
  });

  it("has correct total definition count (schemas + operations)", async () => {
    const schemas = await indexDirectory(fixturesDir);
    const petstore = schemas.get("petstore")!;
    // 2 component schemas + 3 path operations
    expect(petstore.definitions.size).toBe(5);
  });

  it("json-schema files have format json-schema", async () => {
    const schemas = await indexDirectory(fixturesDir);
    expect(schemas.get("order")!.format).toBe("json-schema");
    expect(schemas.get("user")!.format).toBe("json-schema");
  });
});

describe("buildMatcher", () => {
  it("plain keyword does substring match", () => {
    const m = buildMatcher("hello");
    expect(m("Hello World")).toBe(true);
    expect(m("goodbye")).toBe(false);
  });

  it("glob * matches any characters", () => {
    const m = buildMatcher("GET*");
    expect(m("GET /pets")).toBe(true);
    expect(m("POST /pets")).toBe(false);
  });

  it("glob ? matches single character", () => {
    const m = buildMatcher("Us?r");
    expect(m("User")).toBe(true);
    expect(m("Ussr")).toBe(true);
    expect(m("Users")).toBe(false);
  });

  it("glob *suffix matches end", () => {
    const m = buildMatcher("*Address");
    expect(m("UserAddress")).toBe(true);
    expect(m("Address")).toBe(true);
    expect(m("AddressLine")).toBe(false);
  });

  it("pipe separates alternatives", () => {
    const m = buildMatcher("user|order");
    expect(m("user")).toBe(true);
    expect(m("order")).toBe(true);
    expect(m("product")).toBe(false);
  });

  it("pipe with globs", () => {
    const m = buildMatcher("GET*|POST*");
    expect(m("GET /pets")).toBe(true);
    expect(m("POST /pets")).toBe(true);
    expect(m("DELETE /pets")).toBe(false);
  });

  it("trims whitespace around pipe terms", () => {
    const m = buildMatcher("user | order");
    expect(m("user")).toBe(true);
    expect(m("order")).toBe(true);
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

  it("searches with glob pattern on definition names", async () => {
    const schemas = await indexDirectory(fixturesDir);
    const petstore = schemas.get("petstore")!;
    const hits = searchInSchema(petstore, "petstore", "GET*");
    const names = hits.map((h) => h.definition);
    expect(names).toContain("GET /pets");
    expect(names).toContain("GET /pets/{petId}");
    expect(names).not.toContain("POST /pets");
  });

  it("searches with pipe-separated alternatives", async () => {
    const schemas = await indexSchemas(fixturesDir);
    const hits = searchInSchema(schemas.get("order")!, "order", "Address|LineItem");
    const names = hits.map((h) => h.definition);
    expect(names).toContain("Address");
    expect(names).toContain("LineItem");
  });

  it("searches OpenAPI operations by content", async () => {
    const schemas = await indexDirectory(fixturesDir);
    const petstore = schemas.get("petstore")!;
    const hits = searchInSchema(petstore, "petstore", "listPets");
    const names = hits.map((h) => h.definition);
    expect(names).toContain("GET /pets");
  });
});
