import type { ParsedArgs } from "./args.js";
import { getOption } from "./args.js";

export function getBaseUrl(args: ParsedArgs): string {
  const baseUrl =
    getOption(args, "base-url") ??
    process.env.DISCOURSE_BASE_URL ??
    process.env.DISCOURSE_URL;

  if (!baseUrl) {
    throw new Error("Missing base URL. Use --base-url or DISCOURSE_BASE_URL");
  }

  return baseUrl.replace(/\/+$/, "");
}

export function buildAuthHeaders(args: ParsedArgs): Record<string, string> {
  const headers: Record<string, string> = {};

  const apiKey = getOption(args, "api-key") ?? process.env.DISCOURSE_API_KEY;
  const apiUsername =
    getOption(args, "api-username") ?? process.env.DISCOURSE_API_USERNAME;

  const userApiKey =
    getOption(args, "user-api-key") ?? process.env.DISCOURSE_USER_API_KEY;
  const userApiClientId =
    getOption(args, "user-api-client-id") ??
    process.env.DISCOURSE_USER_API_CLIENT_ID;

  if (apiKey) {
    headers["Api-Key"] = apiKey;
  }

  if (apiUsername) {
    headers["Api-Username"] = apiUsername;
  }

  if (userApiKey) {
    headers["User-Api-Key"] = userApiKey;
  }

  if (userApiClientId) {
    headers["User-Api-Client-Id"] = userApiClientId;
  }

  return headers;
}
