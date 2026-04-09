import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export type OpenApiDocument = {
  info?: {
    title?: string;
    version?: string;
  };
  paths: Record<string, Record<string, OpenApiOperation>>;
};

export type OpenApiOperation = {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: Array<{
    name: string;
    in: string;
    required?: boolean;
    schema?: {
      type?: string;
      enum?: unknown[];
    };
    description?: string;
  }>;
  requestBody?: {
    content?: Record<string, { schema?: unknown }>;
  };
};

export type OperationRecord = {
  method: string;
  path: string;
  operation: OpenApiOperation;
};

const DEFAULT_SPEC_URL = "https://docs.discourse.org/openapi.json";
const DEFAULT_SPEC_FILE = resolve(process.cwd(), ".cache", "discourse-openapi.json");

export async function syncSpec(
  specUrl = DEFAULT_SPEC_URL,
  specFile = DEFAULT_SPEC_FILE,
): Promise<string> {
  const response = await fetch(specUrl);
  if (!response.ok) {
    throw new Error(`OpenAPI sync failed: ${response.status} ${response.statusText}`);
  }

  const jsonText = await response.text();
  await mkdir(dirname(specFile), { recursive: true });
  await writeFile(specFile, jsonText, "utf8");

  return specFile;
}

export async function loadSpec(options?: {
  specFile?: string;
  specUrl?: string;
  refresh?: boolean;
}): Promise<OpenApiDocument> {
  const specFile = options?.specFile ?? DEFAULT_SPEC_FILE;
  const specUrl = options?.specUrl ?? DEFAULT_SPEC_URL;

  if (options?.refresh) {
    await syncSpec(specUrl, specFile);
  }

  try {
    const content = await readFile(specFile, "utf8");
    return JSON.parse(content) as OpenApiDocument;
  } catch {
    await syncSpec(specUrl, specFile);
    const content = await readFile(specFile, "utf8");
    return JSON.parse(content) as OpenApiDocument;
  }
}

export function getOperationRecords(document: OpenApiDocument): OperationRecord[] {
  const records: OperationRecord[] = [];

  for (const [path, pathItem] of Object.entries(document.paths)) {
    for (const [method, operation] of Object.entries(pathItem)) {
      records.push({
        method: method.toUpperCase(),
        path,
        operation,
      });
    }
  }

  return records.sort((left, right) => {
    const leftId = left.operation.operationId ?? "";
    const rightId = right.operation.operationId ?? "";
    return leftId.localeCompare(rightId);
  });
}

export function findOperationById(
  document: OpenApiDocument,
  operationId: string,
): OperationRecord {
  const record = getOperationRecords(document).find(
    (entry) => entry.operation.operationId === operationId,
  );

  if (!record) {
    throw new Error(`Unknown operationId: ${operationId}`);
  }

  return record;
}
