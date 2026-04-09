import { basename, dirname, resolve } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import {
  getOption,
  getOptions,
  pairsToRecord,
  parseKeyValue,
  type ParsedArgs,
} from "./args.js";
import { buildAuthHeaders } from "./auth.js";

export async function executeApiRequest(input: {
  args: ParsedArgs;
  baseUrl?: string;
  method: string;
  path: string;
  defaultAcceptJson?: boolean;
}): Promise<void> {
  const { args } = input;
  const queryPairs = getOptions(args, "query");
  const headerPairs = getOptions(args, "header");
  const output = getOption(args, "output");

  const url = new URL(resolvePath(input.baseUrl, input.path));
  for (const pair of queryPairs) {
    const { key, value } = parseKeyValue(pair);
    url.searchParams.append(key, value);
  }

  const headers = new Headers({
    ...buildAuthHeaders(args),
    ...recordToStringMap(pairsToRecord(headerPairs, false)),
  });

  if (input.defaultAcceptJson && !headers.has("Accept")) {
    headers.set("Accept", "application/json");
  }

  const body = await buildRequestBody(args, headers);
  const response = await fetch(url, {
    method: input.method.toUpperCase(),
    headers,
    body,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `Request failed: ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ""}`,
    );
  }

  if (!response.body) {
    throw new Error("Request failed: empty response body");
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (output) {
    const outputPath = resolve(output);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, bytes);
    console.log(outputPath);
    return;
  }

  await printResponse(bytes, response);
}

export function renderOperationDescription(input: {
  method: string;
  path: string;
  operationId: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: Array<{
    name: string;
    in: string;
    required?: boolean;
    schema?: { type?: string; enum?: unknown[] };
    description?: string;
  }>;
  contentTypes?: string[];
}): string {
  const lines: string[] = [];

  lines.push(`operationId: ${input.operationId}`);
  lines.push(`method: ${input.method}`);
  lines.push(`path: ${input.path}`);

  if (input.summary) {
    lines.push(`summary: ${input.summary}`);
  }

  if (input.tags && input.tags.length > 0) {
    lines.push(`tags: ${input.tags.join(", ")}`);
  }

  if (input.description) {
    lines.push("");
    lines.push(input.description.trim());
  }

  if (input.parameters && input.parameters.length > 0) {
    lines.push("");
    lines.push("parameters:");
    for (const parameter of input.parameters) {
      const required = parameter.required ? "required" : "optional";
      const schemaType = parameter.schema?.type ?? "unknown";
      const enumSuffix = parameter.schema?.enum
        ? ` enum=${JSON.stringify(parameter.schema.enum)}`
        : "";
      const description = parameter.description ? ` - ${parameter.description}` : "";
      lines.push(
        `- ${parameter.in}.${parameter.name} (${required}, ${schemaType}${enumSuffix})${description}`,
      );
    }
  }

  if (input.contentTypes && input.contentTypes.length > 0) {
    lines.push("");
    lines.push(`requestBody: ${input.contentTypes.join(", ")}`);
  }

  return lines.join("\n");
}

async function buildRequestBody(
  args: ParsedArgs,
  headers: Headers,
): Promise<BodyInit | undefined> {
  const bodyJson = getOption(args, "body-json");
  const bodyPairs = getOptions(args, "body");
  const formPairs = getOptions(args, "form");
  const filePairs = getOptions(args, "file");

  const hasJsonBody = bodyJson !== undefined || bodyPairs.length > 0;
  const hasFormBody = formPairs.length > 0 || filePairs.length > 0;

  if (hasJsonBody && hasFormBody) {
    throw new Error("Use either JSON body options or form/file options, not both");
  }

  if (bodyJson !== undefined) {
    headers.set("Content-Type", "application/json");
    return JSON.stringify(JSON.parse(bodyJson));
  }

  if (bodyPairs.length > 0) {
    headers.set("Content-Type", "application/json");
    return JSON.stringify(pairsToRecord(bodyPairs, true));
  }

  if (hasFormBody) {
    const form = new FormData();

    for (const pair of formPairs) {
      const { key, value } = parseKeyValue(pair);
      form.append(key, value);
    }

    for (const pair of filePairs) {
      const { key, value } = parseKeyValue(pair);
      const bytes = await readFile(value);
      form.append(key, new Blob([bytes]), basename(value));
    }

    return form;
  }

  return undefined;
}

async function printResponse(bytes: Uint8Array, response: Response): Promise<void> {
  const contentType = response.headers.get("content-type") ?? "";
  const text = new TextDecoder().decode(bytes);

  if (contentType.includes("application/json")) {
    console.log(JSON.stringify(JSON.parse(text), null, 2));
    return;
  }

  if (isLikelyText(contentType)) {
    console.log(text);
    return;
  }

  throw new Error(
    `Binary response requires --output. content-type=${contentType || "unknown"}`,
  );
}

function isLikelyText(contentType: string): boolean {
  return (
    contentType.startsWith("text/") ||
    contentType.includes("application/xml") ||
    contentType.includes("application/javascript")
  );
}

function recordToStringMap(
  record: Record<string, unknown>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    if (Array.isArray(value)) {
      result[key] = value.map((entry) => String(entry)).join(", ");
      continue;
    }

    result[key] = String(value);
  }
  return result;
}

function resolvePath(baseUrl: string | undefined, path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  if (!baseUrl) {
    throw new Error("Relative path requires --base-url or DISCOURSE_BASE_URL");
  }

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${baseUrl}${normalizedPath}`;
}

export function resolveOpenApiPath(
  template: string,
  args: ParsedArgs,
): string {
  const pathValues = pairsToRecord(getOptions(args, "path"), false);
  return template.replace(/\{([^}]+)\}/g, (_, key: string) => {
    const value = pathValues[key];
    if (value === undefined || Array.isArray(value)) {
      throw new Error(`Missing path parameter: ${key}`);
    }
    return encodeURIComponent(String(value));
  });
}

export function defaultAttachmentOutput(url: string, response: Response): string {
  const disposition = response.headers.get("content-disposition");
  if (disposition) {
    const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
    if (utf8Match) {
      return decodeURIComponent(utf8Match[1]);
    }

    const plainMatch = disposition.match(/filename="([^"]+)"/i);
    if (plainMatch) {
      return plainMatch[1];
    }
  }

  return basename(new URL(url).pathname) || "download.bin";
}

export async function downloadAttachment(args: ParsedArgs, url: string): Promise<void> {
  const headers = new Headers(buildAuthHeaders(args));
  const response = await fetch(url, { headers });
  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `Download failed: ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ""}`,
    );
  }

  const output = getOption(args, "output") ?? defaultAttachmentOutput(url, response);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const outputPath = resolve(output);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, bytes);
  console.log(outputPath);
}
