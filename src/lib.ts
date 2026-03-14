import { readdir, readFile } from "node:fs/promises";
import { join, basename } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SchemaFormat = "json-schema" | "openapi-3" | "swagger-2";

export interface IndexedSchema {
  filename: string;
  format: SchemaFormat;
  title: string | undefined;
  description: string | undefined;
  definitions: Map<string, Record<string, unknown>>;
}

export interface SearchHit {
  schema: string;
  definition: string;
}

// ---------------------------------------------------------------------------
// Format detection
// ---------------------------------------------------------------------------

export function detectFormat(parsed: Record<string, unknown>): SchemaFormat {
  if (typeof parsed.openapi === "string" && parsed.openapi.startsWith("3."))
    return "openapi-3";
  if (typeof parsed.swagger === "string" && parsed.swagger.startsWith("2."))
    return "swagger-2";
  return "json-schema";
}

// ---------------------------------------------------------------------------
// Definition extraction
// ---------------------------------------------------------------------------

function extractDefs(
  parsed: Record<string, unknown>,
  format: SchemaFormat,
): Map<string, Record<string, unknown>> {
  const defs = new Map<string, Record<string, unknown>>();

  // --- schemas / definitions ---
  let rawDefs: Record<string, Record<string, unknown>> | undefined;
  if (format === "openapi-3") {
    const components = parsed.components as Record<string, unknown> | undefined;
    rawDefs = components?.schemas as
      | Record<string, Record<string, unknown>>
      | undefined;
  } else {
    // json-schema and swagger-2 both use $defs / definitions at root
    rawDefs =
      (parsed.$defs as Record<string, Record<string, unknown>> | undefined) ??
      (parsed.definitions as
        | Record<string, Record<string, unknown>>
        | undefined);
  }

  if (rawDefs && typeof rawDefs === "object") {
    for (const [name, def] of Object.entries(rawDefs)) {
      defs.set(name, def);
    }
  }

  // --- OpenAPI paths → operations ---
  const paths = parsed.paths as
    | Record<string, Record<string, unknown>>
    | undefined;
  if (
    paths &&
    typeof paths === "object" &&
    (format === "openapi-3" || format === "swagger-2")
  ) {
    const httpMethods = [
      "get",
      "put",
      "post",
      "delete",
      "options",
      "head",
      "patch",
      "trace",
    ];
    for (const [path, pathItem] of Object.entries(paths)) {
      if (!pathItem || typeof pathItem !== "object") continue;
      for (const method of httpMethods) {
        const op = pathItem[method] as Record<string, unknown> | undefined;
        if (op && typeof op === "object") {
          defs.set(`${method.toUpperCase()} ${path}`, op);
        }
      }
    }
  }

  return defs;
}

function getMetadata(
  parsed: Record<string, unknown>,
  format: SchemaFormat,
): { title: string | undefined; description: string | undefined } {
  if (format === "openapi-3" || format === "swagger-2") {
    const info = parsed.info as Record<string, unknown> | undefined;
    return {
      title: info?.title as string | undefined,
      description: info?.description as string | undefined,
    };
  }
  return {
    title: parsed.title as string | undefined,
    description: parsed.description as string | undefined,
  };
}

// ---------------------------------------------------------------------------
// Index a single parsed document
// ---------------------------------------------------------------------------

function indexParsed(
  parsed: Record<string, unknown>,
  filename: string,
  name: string,
): IndexedSchema {
  const format = detectFormat(parsed);
  const { title, description } = getMetadata(parsed, format);
  const definitions = extractDefs(parsed, format);
  return { filename, format, title, description, definitions };
}

// ---------------------------------------------------------------------------
// Source loading
// ---------------------------------------------------------------------------

/** Index all .json files in a directory (recursive). */
export async function indexDirectory(
  dir: string,
): Promise<Map<string, IndexedSchema>> {
  const index = new Map<string, IndexedSchema>();
  const files = await readdir(dir, { recursive: true });

  for (const file of files) {
    if (typeof file !== "string" || !file.endsWith(".json")) continue;

    const content = await readFile(join(dir, file), "utf-8");
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(content);
    } catch {
      console.error(`Skipping invalid JSON: ${file}`);
      continue;
    }

    const name = basename(file, ".json");
    index.set(name, indexParsed(parsed, file, name));
  }

  return index;
}

/** Fetch a JSON document from a URL and index it. */
export async function indexUrl(
  url: string,
): Promise<Map<string, IndexedSchema>> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  const text = await response.text();
  const parsed = JSON.parse(text) as Record<string, unknown>;

  // Derive a schema name from the URL path
  const urlPath = new URL(url).pathname;
  const ext = urlPath.endsWith(".json") ? ".json" : "";
  const name = basename(urlPath, ext) || "schema";

  const index = new Map<string, IndexedSchema>();
  index.set(name, indexParsed(parsed, url, name));
  return index;
}

/**
 * Index a single source (local directory or HTTP(S) URL).
 */
export async function indexSource(
  source: string,
): Promise<Map<string, IndexedSchema>> {
  if (source.startsWith("http://") || source.startsWith("https://")) {
    return indexUrl(source);
  }
  return indexDirectory(source);
}

/**
 * Index multiple sources and merge into a single map.
 * On name collisions the later source wins (with a warning on stderr).
 */
export async function indexSources(
  sources: string[],
): Promise<Map<string, IndexedSchema>> {
  const merged = new Map<string, IndexedSchema>();
  for (const source of sources) {
    const result = await indexSource(source);
    for (const [name, schema] of result) {
      if (merged.has(name)) {
        console.error(
          `Warning: schema "${name}" from ${schema.filename} overwrites earlier entry from ${merged.get(name)!.filename}`,
        );
      }
      merged.set(name, schema);
    }
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Backward-compat alias
// ---------------------------------------------------------------------------
export const indexSchemas = indexDirectory;

// ---------------------------------------------------------------------------
// Search helpers
// ---------------------------------------------------------------------------

/**
 * Build a matcher function from a search expression.
 *
 * Supports:
 *  - Pipe `|` as OR separator: `"pet|error"` matches either term
 *  - Glob wildcards `*` and `?`: `"GET*"` matches strings starting with GET
 *  - Plain strings: substring match (case-insensitive)
 */
export function buildMatcher(expr: string): (text: string) => boolean {
  const terms = expr
    .split("|")
    .map((t) => t.trim())
    .filter(Boolean);

  const matchers = terms.map((term) => {
    if (term.includes("*") || term.includes("?")) {
      // Glob → regex: escape regex-special chars except * and ?
      const escaped = term.replace(/[.+^${}()|[\]\\]/g, "\\$&");
      const pattern = escaped.replace(/\*/g, ".*").replace(/\?/g, ".");
      const re = new RegExp(`^${pattern}$`, "i");
      return (text: string) => re.test(text);
    }
    const lk = term.toLowerCase();
    return (text: string) => text.toLowerCase().includes(lk);
  });

  return (text: string) => matchers.some((m) => m(text));
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export function matchesKeyword(obj: unknown, keyword: string): boolean;
export function matchesKeyword(obj: unknown, matcher: (t: string) => boolean): boolean;
export function matchesKeyword(
  obj: unknown,
  keywordOrMatcher: string | ((t: string) => boolean),
): boolean {
  const match =
    typeof keywordOrMatcher === "function"
      ? keywordOrMatcher
      : buildMatcher(keywordOrMatcher);

  return _matchesDeep(obj, match);
}

function _matchesDeep(obj: unknown, match: (t: string) => boolean): boolean {
  if (typeof obj === "string") return match(obj);
  if (Array.isArray(obj)) return obj.some((v) => _matchesDeep(v, match));
  if (obj && typeof obj === "object") {
    return Object.entries(obj).some(
      ([k, v]) => match(k) || _matchesDeep(v, match),
    );
  }
  return false;
}

export function searchInSchema(
  schema: IndexedSchema,
  schemaName: string,
  keyword: string,
): SearchHit[] {
  const match = buildMatcher(keyword);
  const hits: SearchHit[] = [];
  for (const [defName, defSchema] of schema.definitions) {
    if (match(defName) || _matchesDeep(defSchema, match)) {
      hits.push({ schema: schemaName, definition: defName });
    }
  }
  return hits;
}
