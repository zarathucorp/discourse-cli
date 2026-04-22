#!/usr/bin/env node
import {
  getOption,
  hasFlag,
  parseArgs,
  type ParsedArgs,
} from "./args.js";
import { getBaseUrl } from "./auth.js";
import {
  findOperationById,
  getOperationRecords,
  loadSpec,
  syncSpec,
} from "./openapi.js";
import {
  downloadAttachment,
  executeApiRequest,
  renderOperationDescription,
  resolveOpenApiPath,
} from "./request.js";
import { runConversationsExport } from "./conversations.js";
import { runPostsCreate, runPostsUpdate } from "./posts.js";

function printHelp(): void {
  console.log(`Usage:
  discourse-cli spec sync [--spec-file <path>] [--spec-url <url>]
  discourse-cli api list [--search <term>] [--method <METHOD>] [--tag <tag>]
  discourse-cli api describe <operationId>
  discourse-cli api run <operationId> [request options]
  discourse-cli api call <METHOD> <path> [request options]
  discourse-cli posts create [post options]
  discourse-cli posts update [post options]
  discourse-cli conversations export --user-id <id|username> [conversation options]
  discourse-cli attachment download <url> [--output <path>]

Common request options:
  --base-url <url>
  --api-key <key>
  --api-username <username>
  --user-api-key <key>
  --user-api-client-id <id>
  --path key=value
  --query key=value
  --header key=value
  --body key=value
  --body-json <json>
  --form key=value
  --file field=/path/to/file
  --output <path>

Post options:
  --title <title>
  --category <id>
  --topic-id <id>
  --post-id <id>
  --raw <text>
  --raw-file <path>
  --edit-reason <text>
  --bypass-bump

Conversation options:
  --user-id <id|username>
  --user <username>
  --output-dir <path>
  --page-size <count>
  --skip-attachments

Environment:
  DISCOURSE_BASE_URL / DISCOURSE_URL
  DISCOURSE_API_KEY
  DISCOURSE_API_USERNAME
  DISCOURSE_USER_API_KEY
  DISCOURSE_USER_API_CLIENT_ID`);
}

async function runSpecSync(args: ParsedArgs): Promise<void> {
  const specFile = getOption(args, "spec-file");
  const specUrl = getOption(args, "spec-url");
  const outputPath = await syncSpec(specUrl, specFile);
  console.log(outputPath);
}

async function runApiList(args: ParsedArgs): Promise<void> {
  const document = await loadSpec({
    specFile: getOption(args, "spec-file"),
    specUrl: getOption(args, "spec-url"),
    refresh: hasFlag(args, "refresh"),
  });

  const search = getOption(args, "search")?.toLowerCase();
  const method = getOption(args, "method")?.toUpperCase();
  const tag = getOption(args, "tag")?.toLowerCase();

  const records = getOperationRecords(document)
    .filter((record) => {
      if (method && record.method !== method) {
        return false;
      }

      if (tag) {
        const tags = record.operation.tags?.map((entry) => entry.toLowerCase()) ?? [];
        if (!tags.includes(tag)) {
          return false;
        }
      }

      if (!search) {
        return true;
      }

      const haystack = [
        record.operation.operationId,
        record.operation.summary,
        record.path,
        record.method,
        ...(record.operation.tags ?? []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(search);
    })
    .map((record) => ({
      operationId: record.operation.operationId ?? "<missing>",
      method: record.method,
      path: record.path,
      summary: record.operation.summary ?? "",
    }));

  console.log(JSON.stringify(records, null, 2));
}

async function runApiDescribe(args: ParsedArgs, operationId: string): Promise<void> {
  const document = await loadSpec({
    specFile: getOption(args, "spec-file"),
    specUrl: getOption(args, "spec-url"),
    refresh: hasFlag(args, "refresh"),
  });

  const record = findOperationById(document, operationId);
  console.log(renderOperationDescription({
    operationId,
    method: record.method,
    path: record.path,
    summary: record.operation.summary,
    description: record.operation.description,
    tags: record.operation.tags,
    parameters: record.operation.parameters,
    contentTypes: Object.keys(record.operation.requestBody?.content ?? {}),
  }));
}

async function runApiByOperationId(
  args: ParsedArgs,
  operationId: string,
): Promise<void> {
  const document = await loadSpec({
    specFile: getOption(args, "spec-file"),
    specUrl: getOption(args, "spec-url"),
    refresh: hasFlag(args, "refresh"),
  });
  const record = findOperationById(document, operationId);
  const path = resolveOpenApiPath(record.path, args);

  await executeApiRequest({
    args,
    baseUrl: getBaseUrl(args),
    method: record.method,
    path,
    defaultAcceptJson: true,
  });
}

async function runRawApiCall(
  args: ParsedArgs,
  method: string,
  path: string,
): Promise<void> {
  await executeApiRequest({
    args,
    baseUrl: getBaseUrl(args),
    method,
    path,
    defaultAcceptJson: true,
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const [resource, action, ...rest] = args.positionals;

  if (!resource || hasFlag(args, "help")) {
    printHelp();
    return;
  }

  if (resource === "spec" && action === "sync") {
    await runSpecSync(args);
    return;
  }

  if (resource === "api" && action === "list") {
    await runApiList(args);
    return;
  }

  if (resource === "api" && action === "describe") {
    const operationId = rest[0];
    if (!operationId) {
      throw new Error("Missing operationId");
    }
    await runApiDescribe(args, operationId);
    return;
  }

  if (resource === "api" && action === "run") {
    const operationId = rest[0];
    if (!operationId) {
      throw new Error("Missing operationId");
    }
    await runApiByOperationId(args, operationId);
    return;
  }

  if (resource === "api" && action === "call") {
    const [method, path] = rest;
    if (!method || !path) {
      throw new Error("Usage: discourse-cli api call <METHOD> <path>");
    }
    await runRawApiCall(args, method, path);
    return;
  }

  if (resource === "attachment" && action === "download") {
    const url = rest[0];
    if (!url) {
      throw new Error("Missing attachment URL");
    }
    await downloadAttachment(args, url);
    return;
  }

  if (resource === "posts" && action === "create") {
    await runPostsCreate(args);
    return;
  }

  if (resource === "posts" && action === "update") {
    await runPostsUpdate(args);
    return;
  }

  if (resource === "conversations" && action === "export") {
    await runConversationsExport(args);
    return;
  }

  printHelp();
  throw new Error("Unsupported command");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
