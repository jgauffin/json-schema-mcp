import { readdir, readFile } from "node:fs/promises";
import { join, basename } from "node:path";

export interface IndexedSchema {
  filename: string;
  title: string | undefined;
  description: string | undefined;
  definitions: Map<string, Record<string, unknown>>;
}

export interface SearchHit {
  schema: string;
  definition: string;
}

export async function indexSchemas(dir: string): Promise<Map<string, IndexedSchema>> {
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

    const defs = new Map<string, Record<string, unknown>>();
    const rawDefs =
      (parsed.$defs as Record<string, Record<string, unknown>> | undefined) ??
      (parsed.definitions as Record<string, Record<string, unknown>> | undefined);

    if (rawDefs && typeof rawDefs === "object") {
      for (const [name, def] of Object.entries(rawDefs)) {
        defs.set(name, def);
      }
    }

    const name = basename(file, ".json");
    index.set(name, {
      filename: file,
      title: parsed.title as string | undefined,
      description: parsed.description as string | undefined,
      definitions: defs,
    });
  }

  return index;
}

export function matchesKeyword(obj: unknown, keyword: string): boolean {
  if (typeof obj === "string") return obj.toLowerCase().includes(keyword);
  if (Array.isArray(obj)) return obj.some((v) => matchesKeyword(v, keyword));
  if (obj && typeof obj === "object") {
    return Object.entries(obj).some(
      ([k, v]) => k.toLowerCase().includes(keyword) || matchesKeyword(v, keyword)
    );
  }
  return false;
}

export function searchInSchema(schema: IndexedSchema, schemaName: string, keyword: string): SearchHit[] {
  const lk = keyword.toLowerCase();
  const hits: SearchHit[] = [];
  for (const [defName, defSchema] of schema.definitions) {
    if (defName.toLowerCase().includes(lk) || matchesKeyword(defSchema, lk)) {
      hits.push({ schema: schemaName, definition: defName });
    }
  }
  return hits;
}
