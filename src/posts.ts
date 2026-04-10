import { basename, dirname, resolve } from "node:path";
import { readFile, stat } from "node:fs/promises";

import { getOption, hasFlag, type ParsedArgs } from "./args.js";
import { buildAuthHeaders, getBaseUrl } from "./auth.js";

type PostPayload = {
  raw: string;
  title?: string;
  category?: number;
  topic_id?: number;
};

type UploadResponse = {
  url: string;
  original_filename: string;
  filesize: number;
  width: number;
  height: number;
  thumbnail_width: number;
  thumbnail_height: number;
  short_url: string;
  short_path: string;
  human_filesize: string;
};

type UpdatePostPayload = {
  post: {
    raw: string;
    edit_reason?: string;
  };
  bypass_bump?: boolean;
};

type LocalReference = {
  start: number;
  end: number;
  original: string;
  resolvedPath: string;
};

export async function runPostsCreate(args: ParsedArgs): Promise<void> {
  const payload = await buildPostPayload(args);
  const data = await executeJsonRequest(args, "POST", "/posts.json", payload);
  console.log(JSON.stringify(data, null, 2));
}

export async function runPostsUpdate(args: ParsedArgs): Promise<void> {
  const postId = parseRequiredInteger(getOption(args, "post-id"), "post-id");
  validateUpdateOptions(args);
  const payload = await buildUpdatePostPayload(args);
  const data = await executeJsonRequest(
    args,
    "PUT",
    `/posts/${postId}.json`,
    payload,
  );
  console.log(JSON.stringify(data, null, 2));
}

async function buildPostPayload(args: ParsedArgs): Promise<PostPayload> {
  validateCreateOptions(args);
  const raw = await loadRawInput(args);
  const title = getOption(args, "title");
  const category = parseOptionalInteger(getOption(args, "category"), "category");
  const topicId = parseOptionalInteger(getOption(args, "topic-id"), "topic-id");

  if (topicId !== undefined && title) {
    throw new Error("Use --title only when creating a new topic");
  }

  if (topicId !== undefined && category !== undefined) {
    throw new Error("Use --category only when creating a new topic");
  }

  if (topicId === undefined && !title) {
    throw new Error("Missing --title for a new topic");
  }

  const payload: PostPayload = { raw };
  if (title) {
    payload.title = title;
  }
  if (category !== undefined) {
    payload.category = category;
  }
  if (topicId !== undefined) {
    payload.topic_id = topicId;
  }

  return payload;
}

async function buildUpdatePostPayload(
  args: ParsedArgs,
): Promise<UpdatePostPayload> {
  const raw = await loadRawInput(args);
  const editReason = getOption(args, "edit-reason");
  const payload: UpdatePostPayload = {
    post: {
      raw,
    },
  };

  if (editReason) {
    payload.post.edit_reason = editReason;
  }

  if (hasFlag(args, "bypass-bump")) {
    payload.bypass_bump = true;
  }

  return payload;
}

async function loadRawInput(args: ParsedArgs): Promise<string> {
  const inlineRaw = getOption(args, "raw");
  const rawFile = getOption(args, "raw-file");

  if ((inlineRaw ? 1 : 0) + (rawFile ? 1 : 0) !== 1) {
    throw new Error("Use exactly one of --raw or --raw-file");
  }

  if (inlineRaw) {
    return rewriteLocalReferences(args, inlineRaw, process.cwd());
  }

  const rawPath = resolve(rawFile!);
  const raw = await readFile(rawPath, "utf8");
  return rewriteLocalReferences(args, stripBom(raw), dirname(rawPath));
}

async function rewriteLocalReferences(
  args: ParsedArgs,
  raw: string,
  baseDir: string,
): Promise<string> {
  const references = collectLocalReferences(raw, baseDir);
  if (references.length === 0) {
    return raw;
  }

  const uniquePaths = [...new Set(references.map((reference) => reference.resolvedPath))];
  for (const filePath of uniquePaths) {
    const fileStat = await stat(filePath).catch(() => null);
    if (!fileStat?.isFile()) {
      throw new Error(`Local upload target is missing or not a file: ${filePath}`);
    }
  }

  const uploaded = new Map<string, string>();
  const baseUrl = getBaseUrl(args);
  for (const filePath of uniquePaths) {
    const upload = await uploadFile(args, baseUrl, filePath);
    uploaded.set(filePath, buildUploadMarkdown(upload));
  }

  let rewritten = "";
  let cursor = 0;
  for (const reference of references) {
    rewritten += raw.slice(cursor, reference.start);
    rewritten += uploaded.get(reference.resolvedPath) ?? reference.original;
    cursor = reference.end;
  }
  rewritten += raw.slice(cursor);
  return rewritten;
}

function collectLocalReferences(raw: string, baseDir: string): LocalReference[] {
  const references: LocalReference[] = [];
  let index = 0;
  let inFence = false;
  let fenceMarker = "";

  while (index < raw.length) {
    if (isLineStart(raw, index)) {
      const fence = readFence(raw, index);
      if (fence) {
        if (!inFence) {
          inFence = true;
          fenceMarker = fence.marker;
        } else if (fence.marker === fenceMarker && fence.length >= fenceMarker.length) {
          inFence = false;
          fenceMarker = "";
        }

        index = moveToNextLine(raw, index);
        continue;
      }
    }

    if (inFence) {
      index += 1;
      continue;
    }

    const codeSpanEnd = readCodeSpan(raw, index);
    if (codeSpanEnd !== null) {
      index = codeSpanEnd;
      continue;
    }

    const reference = parseInlineReference(raw, index, baseDir);
    if (reference) {
      references.push(reference);
      index = reference.end;
      continue;
    }

    index += 1;
  }

  return references;
}

function parseInlineReference(
  raw: string,
  index: number,
  baseDir: string,
): LocalReference | null {
  const isImage = raw[index] === "!" && raw[index + 1] === "[";
  const linkStart = isImage ? index + 1 : index;
  if (raw[linkStart] !== "[") {
    return null;
  }

  const labelEnd = findClosingBracket(raw, linkStart);
  if (labelEnd === -1) {
    return null;
  }

  let cursor = labelEnd + 1;
  while (raw[cursor] === " " || raw[cursor] === "\t") {
    cursor += 1;
  }

  if (raw[cursor] !== "(") {
    return null;
  }

  const targetEnd = findClosingParen(raw, cursor);
  if (targetEnd === -1) {
    return null;
  }

  const destination = extractDestination(raw.slice(cursor + 1, targetEnd));
  if (!destination) {
    return null;
  }

  const resolvedPath = resolveLocalPath(destination, baseDir);
  if (!resolvedPath) {
    return null;
  }

  return {
    start: index,
    end: targetEnd + 1,
    original: raw.slice(index, targetEnd + 1),
    resolvedPath,
  };
}

function findClosingBracket(raw: string, openingIndex: number): number {
  let depth = 0;

  for (let index = openingIndex; index < raw.length; index += 1) {
    const char = raw[index];
    if (char === "\\") {
      index += 1;
      continue;
    }

    if (char === "[") {
      depth += 1;
      continue;
    }

    if (char === "]") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function findClosingParen(raw: string, openingIndex: number): number {
  let depth = 0;
  let quote: "\"" | "'" | null = null;

  for (let index = openingIndex; index < raw.length; index += 1) {
    const char = raw[index];
    if (char === "\\") {
      index += 1;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }

    if (char === "(") {
      depth += 1;
      continue;
    }

    if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function extractDestination(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("<")) {
    const closingIndex = trimmed.indexOf(">");
    if (closingIndex === -1) {
      return null;
    }
    return trimmed.slice(1, closingIndex).trim();
  }

  for (let index = 0; index < trimmed.length; index += 1) {
    if (/\s/.test(trimmed[index])) {
      return trimmed.slice(0, index);
    }
  }

  return trimmed;
}

function resolveLocalPath(destination: string, baseDir: string): string | null {
  const stripped = stripQueryAndHash(safeDecode(destination));
  if (!stripped) {
    return null;
  }

  const lowered = stripped.toLowerCase();
  if (
    lowered.startsWith("http://") ||
    lowered.startsWith("https://") ||
    lowered.startsWith("mailto:") ||
    lowered.startsWith("data:") ||
    lowered.startsWith("upload://") ||
    lowered.startsWith("//") ||
    lowered.startsWith("#")
  ) {
    return null;
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(stripped)) {
    return null;
  }

  if (
    stripped.startsWith("/uploads/") ||
    stripped.startsWith("/images/") ||
    stripped.startsWith("/secure-uploads/") ||
    stripped.startsWith("uploads/short-url/") ||
    stripped.startsWith("uploads/default/")
  ) {
    return null;
  }

  return stripped.startsWith("/") ? resolve(stripped) : resolve(baseDir, stripped);
}

function stripQueryAndHash(input: string): string {
  const hashIndex = input.indexOf("#");
  const queryIndex = input.indexOf("?");
  const endIndex = [hashIndex, queryIndex]
    .filter((value) => value >= 0)
    .sort((left, right) => left - right)[0];

  if (endIndex === undefined) {
    return input;
  }

  return input.slice(0, endIndex);
}

function safeDecode(input: string): string {
  try {
    return decodeURIComponent(input);
  } catch {
    return input;
  }
}

function readCodeSpan(raw: string, index: number): number | null {
  if (raw[index] !== "`") {
    return null;
  }

  let width = 1;
  while (raw[index + width] === "`") {
    width += 1;
  }

  const marker = "`".repeat(width);
  const closingIndex = raw.indexOf(marker, index + width);
  if (closingIndex === -1) {
    return index + width;
  }

  return closingIndex + width;
}

function readFence(
  raw: string,
  index: number,
): { marker: string; length: number } | null {
  let cursor = index;
  let spaces = 0;
  while (raw[cursor] === " " || raw[cursor] === "\t") {
    spaces += 1;
    cursor += 1;
    if (spaces > 3) {
      return null;
    }
  }

  const markerChar = raw[cursor];
  if (markerChar !== "`" && markerChar !== "~") {
    return null;
  }

  let width = 0;
  while (raw[cursor + width] === markerChar) {
    width += 1;
  }

  if (width < 3) {
    return null;
  }

  return { marker: markerChar.repeat(width), length: width };
}

function isLineStart(raw: string, index: number): boolean {
  return index === 0 || raw[index - 1] === "\n";
}

function moveToNextLine(raw: string, index: number): number {
  const newlineIndex = raw.indexOf("\n", index);
  return newlineIndex === -1 ? raw.length : newlineIndex + 1;
}

async function uploadFile(
  args: ParsedArgs,
  baseUrl: string,
  filePath: string,
): Promise<UploadResponse> {
  const bytes = await readFile(filePath);
  const form = new FormData();
  form.append("type", "composer");
  form.append("synchronous", "true");
  form.append("file", new Blob([bytes]), basename(filePath));

  const response = await fetch(resolveApiUrl(baseUrl, "/uploads.json"), {
    method: "POST",
    headers: new Headers(buildAuthHeaders(args)),
    body: form,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `Upload failed: ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ""}`,
    );
  }

  return (await response.json()) as UploadResponse;
}

function buildUploadMarkdown(upload: UploadResponse): string {
  const shortUrl = upload.short_url || upload.url;
  const fileName = sanitizeMarkdownName(upload.original_filename);

  if (isImage(upload.original_filename)) {
    return `![${fileName}|${upload.thumbnail_width}x${upload.thumbnail_height}](${shortUrl})`;
  }

  if (isAudio(upload.original_filename)) {
    return `![${fileName}|audio](${shortUrl})`;
  }

  if (isVideo(upload.original_filename)) {
    return `![${fileName}|video](${shortUrl})`;
  }

  return `[${upload.original_filename}|attachment](${shortUrl}) (${upload.human_filesize})`;
}

function sanitizeMarkdownName(fileName: string): string {
  const extensionIndex = fileName.lastIndexOf(".");
  const baseName = extensionIndex > 0 ? fileName.slice(0, extensionIndex) : fileName;
  return baseName.replace(/[\[\]\|]/g, "");
}

function isImage(path: string): boolean {
  return /\.(png|webp|jpe?g|gif|svg|ico|heic|heif|avif)$/i.test(path);
}

function isVideo(path: string): boolean {
  return /\.(mov|mp4|webm|m4v|3gp|ogv|avi|mpeg)$/i.test(path);
}

function isAudio(path: string): boolean {
  return /\.(mp3|og[ga]|opus|wav|m4[abpr]|aac|flac)$/i.test(path);
}

function parseOptionalInteger(
  value: string | undefined,
  optionName: string,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid --${optionName}: ${value}`);
  }

  return parsed;
}

function parseRequiredInteger(value: string | undefined, optionName: string): number {
  const parsed = parseOptionalInteger(value, optionName);
  if (parsed === undefined) {
    throw new Error(`Missing --${optionName}`);
  }
  return parsed;
}

function validateCreateOptions(args: ParsedArgs): void {
  if (getOption(args, "post-id") !== undefined) {
    throw new Error("Use --post-id only with posts update");
  }

  if (getOption(args, "edit-reason") !== undefined) {
    throw new Error("Use --edit-reason only with posts update");
  }

  if (hasFlag(args, "bypass-bump")) {
    throw new Error("Use --bypass-bump only with posts update");
  }
}

function validateUpdateOptions(args: ParsedArgs): void {
  if (getOption(args, "title") !== undefined) {
    throw new Error("Use --title only with posts create");
  }

  if (getOption(args, "category") !== undefined) {
    throw new Error("Use --category only with posts create");
  }

  if (getOption(args, "topic-id") !== undefined) {
    throw new Error("Use --topic-id only with posts create");
  }
}

async function executeJsonRequest(
  args: ParsedArgs,
  method: "POST" | "PUT",
  path: string,
  payload: unknown,
): Promise<unknown> {
  const baseUrl = getBaseUrl(args);
  const response = await fetch(resolveApiUrl(baseUrl, path), {
    method,
    headers: new Headers({
      ...buildAuthHeaders(args),
      Accept: "application/json",
      "Content-Type": "application/json",
    }),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `Request failed: ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ""}`,
    );
  }

  return response.json();
}

function resolveApiUrl(baseUrl: string, path: string): URL {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return new URL(`${baseUrl}${normalizedPath}`);
}

function stripBom(input: string): string {
  return input.replace(/^\uFEFF/, "");
}
