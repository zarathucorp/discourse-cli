import { mkdir, writeFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";

import { getBaseUrl } from "./auth.js";
import { getOption, hasFlag, type ParsedArgs } from "./args.js";
import { downloadToPath, requestJson } from "./request.js";

type AdminUserResponse = {
  id?: number;
  username?: string;
  user?: {
    id?: number;
    username?: string;
  };
};

type ConversationListResponse = {
  conversations?: ConversationSummary[];
  meta?: {
    total?: number;
    page?: number;
    per_page?: number;
    has_more?: boolean;
  };
};

type PrivateMessageListResponse = {
  topic_list?: {
    per_page?: number;
    topics?: ConversationSummary[];
  };
};

type UserActionsResponse = {
  user_actions?: UserAction[];
};

type ConversationSummary = {
  id: number;
  title?: string;
  slug?: string;
  created_at?: string;
  last_posted_at?: string;
  posts_count?: number;
};

type UserAction = {
  topic_id: number;
  title?: string;
  slug?: string;
  created_at?: string;
  post_number?: number;
};

type TopicResponse = {
  id: number;
  title?: string;
  slug?: string;
  created_at?: string;
  last_posted_at?: string;
  post_stream?: {
    stream?: number[];
    posts?: TopicPost[];
  };
};

type TopicPostsResponse = {
  post_stream?: {
    posts?: TopicPost[];
  };
};

type TopicPost = {
  id: number;
  post_number: number;
  user_id?: number;
  username?: string;
  name?: string;
  created_at?: string;
  updated_at?: string;
  reply_to_post_number?: number;
  post_type?: number;
  raw?: string;
  cooked?: string;
};

type ExportedAttachment = {
  url: string;
  post_id: number;
  post_number: number;
  local_path?: string;
  download_error?: string;
};

type ExportedConversation = {
  topic_id: number;
  title: string;
  slug?: string;
  started_at?: string;
  last_posted_at?: string;
  directory: string;
  attachment_count: number;
};

type SkippedConversation = {
  topic_id: number;
  title?: string;
  reason: string;
};

const DEFAULT_OUTPUT_DIR = "exports/conversations";
const DEFAULT_PAGE_SIZE = 40;
const POST_CHUNK_SIZE = 50;
const SESSION_TITLE_LIMIT = 80;

export async function runConversationsExport(
  args: ParsedArgs,
): Promise<void> {
  const userIdentifier = getRequiredUserIdentifier(args);
  const pageSize = parsePositiveInteger(
    getOption(args, "page-size") ?? String(DEFAULT_PAGE_SIZE),
    "page-size",
  );
  const outputRoot = resolve(getOption(args, "output-dir") ?? DEFAULT_OUTPUT_DIR);
  const includeAttachments = !hasFlag(args, "skip-attachments");
  const baseUrl = getBaseUrl(args);

  const targetUser = await resolveTargetUser(args, userIdentifier);
  const userRoot = resolve(
    outputRoot,
    `${targetUser.id}-${slugify(targetUser.username, "user")}`,
  );
  await mkdir(userRoot, { recursive: true });

  const conversations = await listAllConversations(args, targetUser.username, pageSize);
  const exported: ExportedConversation[] = [];
  const skipped: SkippedConversation[] = [];

  for (const conversation of conversations) {
    let topic: TopicResponse;
    try {
      topic = await fetchFullTopic(args, targetUser.username, conversation.id);
    } catch (error) {
      skipped.push({
        topic_id: conversation.id,
        title: conversation.title,
        reason: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    const posts = sortPosts(topic.post_stream?.posts ?? []);
    const sessionDirName = buildSessionDirName(topic, posts);
    const sessionDir = resolve(userRoot, sessionDirName);
    await mkdir(sessionDir, { recursive: true });

    const attachments = includeAttachments
      ? await downloadConversationAttachments({
          args,
          baseUrl,
          username: targetUser.username,
          posts,
          sessionDir,
        })
      : [];

    const startedAt = posts[0]?.created_at ?? topic.created_at ?? conversation.created_at;
    const lastPostedAt =
      posts.at(-1)?.created_at ?? topic.last_posted_at ?? conversation.last_posted_at;

    const conversationPayload = {
      user: targetUser,
      conversation: {
        topic_id: topic.id,
        title: topic.title ?? conversation.title ?? `conversation-${topic.id}`,
        slug: topic.slug ?? conversation.slug,
        started_at: startedAt,
        last_posted_at: lastPostedAt,
        post_count: posts.length,
      },
      posts,
      attachments,
    };

    await writeFile(
      resolve(sessionDir, "conversation.json"),
      `${JSON.stringify(conversationPayload, null, 2)}\n`,
      "utf8",
    );
    await writeFile(
      resolve(sessionDir, "transcript.md"),
      renderTranscriptMarkdown({
        topic,
        posts,
        attachments,
      }),
      "utf8",
    );

    exported.push({
      topic_id: topic.id,
      title: topic.title ?? conversation.title ?? `conversation-${topic.id}`,
      slug: topic.slug ?? conversation.slug,
      started_at: startedAt,
      last_posted_at: lastPostedAt,
      directory: sessionDir,
      attachment_count: attachments.length,
    });
  }

  await writeFile(
    resolve(userRoot, "index.json"),
    `${JSON.stringify({ user: targetUser, conversations: exported, skipped }, null, 2)}\n`,
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        user: targetUser,
        output_dir: userRoot,
        conversations: exported.length,
        skipped: skipped.length,
        attachments_downloaded: exported.reduce(
          (sum, item) => sum + item.attachment_count,
          0,
        ),
      },
      null,
      2,
    ),
  );
}

async function resolveTargetUser(
  args: ParsedArgs,
  userIdentifier: string,
): Promise<{ id: number; username: string }> {
  if (/^\d+$/.test(userIdentifier)) {
    return resolveTargetUserById(args, Number.parseInt(userIdentifier, 10));
  }

  return resolveTargetUserByUsername(args, userIdentifier);
}

async function resolveTargetUserById(
  args: ParsedArgs,
  userId: number,
): Promise<{ id: number; username: string }> {
  const response = await requestJson<AdminUserResponse>({
    args,
    baseUrl: getBaseUrl(args),
    path: `/admin/users/${userId}.json`,
  });

  const id = response.id ?? response.user?.id ?? userId;
  const username = response.username ?? response.user?.username;
  if (!username) {
    throw new Error(`Unable to resolve username for user id ${userId}`);
  }

  return { id, username };
}

async function resolveTargetUserByUsername(
  args: ParsedArgs,
  username: string,
): Promise<{ id: number; username: string }> {
  const encodedUsername = encodeURIComponent(username);
  const attempts = [
    `/u/${encodedUsername}.json`,
    `/users/${encodedUsername}.json`,
    `/u/${encodedUsername}/summary.json`,
  ];

  const failures: string[] = [];
  for (const path of attempts) {
    try {
      const response = await requestJson<AdminUserResponse>({
        args,
        baseUrl: getBaseUrl(args),
        path,
      });

      const resolvedId = response.id ?? response.user?.id;
      const resolvedUsername = response.username ?? response.user?.username ?? username;
      if (resolvedId) {
        return { id: resolvedId, username: resolvedUsername };
      }

      failures.push(`${path}: user payload missing id`);
    } catch (error) {
      failures.push(
        `${path}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  throw new Error(
    `Unable to resolve user for username ${username}. Tried: ${failures.join(" | ")}`,
  );
}

async function listAllConversations(
  args: ParsedArgs,
  username: string,
  pageSize: number,
): Promise<ConversationSummary[]> {
  const userTopics = await listUserActionTopics(args, username, pageSize);
  const privateMessages = await listPrivateMessageConversations(args, username, pageSize);
  return dedupeConversations([...userTopics, ...privateMessages]);
}

async function listPrivateMessageConversations(
  args: ParsedArgs,
  username: string,
  pageSize: number,
): Promise<ConversationSummary[]> {
  const inbox = await listConversationPages(args, username, pageSize, "private-messages");
  const sent = await listConversationPages(args, username, pageSize, "private-messages-sent");
  return dedupeConversations([...inbox, ...sent]);
}

async function listUserActionTopics(
  args: ParsedArgs,
  username: string,
  pageSize: number,
): Promise<ConversationSummary[]> {
  const createdTopics = await listUserActionsByFilter(args, username, 4, pageSize);
  const repliedTopics = await listUserActionsByFilter(args, username, 5, pageSize);
  return dedupeConversations([...createdTopics, ...repliedTopics]);
}

async function listUserActionsByFilter(
  args: ParsedArgs,
  username: string,
  filter: 4 | 5,
  pageSize: number,
): Promise<ConversationSummary[]> {
  const conversations: ConversationSummary[] = [];
  let offset = 0;

  while (true) {
    const query = new URLSearchParams();
    query.set("username", username);
    query.set("filter", String(filter));
    query.set("offset", String(offset));

    const response = await requestJson<UserActionsResponse>({
      args,
      baseUrl: getBaseUrl(args),
      path: "/user_actions.json",
      query,
    });

    const actions = response.user_actions ?? [];
    conversations.push(
      ...actions.map((action) => ({
        id: action.topic_id,
        title: action.title,
        slug: action.slug,
        created_at: action.created_at,
      })),
    );

    if (actions.length === 0 || actions.length < pageSize) {
      return conversations;
    }

    offset += actions.length;
  }
}

async function listConversationPages(
  args: ParsedArgs,
  username: string,
  pageSize: number,
  mailbox: "private-messages" | "private-messages-sent",
): Promise<ConversationSummary[]> {
  const conversations: ConversationSummary[] = [];
  let page = 0;

  while (true) {
    const query = new URLSearchParams();
    query.set("page", String(page));

    const response = await requestJson<PrivateMessageListResponse>({
      args,
      baseUrl: getBaseUrl(args),
      path: `/topics/${mailbox}/${encodeURIComponent(username)}.json`,
      query,
      authOverrides: {
        apiUsername: username,
      },
    });

    const pageItems = response.topic_list?.topics ?? [];
    conversations.push(...pageItems);

    if (pageItems.length === 0 || pageItems.length < pageSize) {
      return conversations;
    }

    page += 1;
  }
}

function dedupeConversations(
  conversations: ConversationSummary[],
): ConversationSummary[] {
  const deduped = new Map<number, ConversationSummary>();
  for (const conversation of conversations) {
    deduped.set(conversation.id, conversation);
  }
  return [...deduped.values()].sort((left, right) => left.id - right.id);
}

async function fetchFullTopic(
  args: ParsedArgs,
  username: string,
  topicId: number,
): Promise<TopicResponse> {
  const topic = await requestJson<TopicResponse>({
    args,
    baseUrl: getBaseUrl(args),
    path: `/t/${topicId}.json`,
    query: new URLSearchParams([["include_raw", "1"]]),
    authOverrides: {
      apiUsername: username,
    },
  });

  const streamIds = topic.post_stream?.stream ?? [];
  const posts = new Map<number, TopicPost>();
  for (const post of topic.post_stream?.posts ?? []) {
    posts.set(post.id, post);
  }

  const missingIds = streamIds.filter((postId) => !posts.has(postId));
  for (let index = 0; index < missingIds.length; index += POST_CHUNK_SIZE) {
    const chunk = missingIds.slice(index, index + POST_CHUNK_SIZE);
    const response = await requestJson<TopicPostsResponse>({
      args,
      baseUrl: getBaseUrl(args),
      path: `/t/${topicId}/posts.json`,
      query: buildPostIdsQuery(chunk),
      authOverrides: {
        apiUsername: username,
      },
    });

    for (const post of response.post_stream?.posts ?? []) {
      posts.set(post.id, post);
    }
  }

  return {
    ...topic,
    post_stream: {
      stream: streamIds,
      posts: sortPosts([...posts.values()]),
    },
  };
}

function buildPostIdsQuery(postIds: number[]): URLSearchParams {
  const query = new URLSearchParams();
  query.set("include_raw", "1");
  for (const postId of postIds) {
    query.append("post_ids[]", String(postId));
  }
  return query;
}

function sortPosts(posts: TopicPost[]): TopicPost[] {
  return [...posts].sort((left, right) => left.post_number - right.post_number);
}

async function downloadConversationAttachments(input: {
  args: ParsedArgs;
  baseUrl: string;
  username: string;
  posts: TopicPost[];
  sessionDir: string;
}): Promise<ExportedAttachment[]> {
  const attachmentsDir = resolve(input.sessionDir, "attachments");
  const results: ExportedAttachment[] = [];
  const usedPaths = new Set<string>();
  const seenUrls = new Set<string>();

  for (const post of input.posts) {
    const urls = extractAttachmentUrls(input.baseUrl, post.cooked ?? "");
    let attachmentIndex = 1;

    for (const url of urls) {
      if (seenUrls.has(`${post.id}:${url}`)) {
        continue;
      }
      seenUrls.add(`${post.id}:${url}`);

      const relativePath = resolveAttachmentPath(
        attachmentsDir,
        post.post_number,
        attachmentIndex,
        url,
        usedPaths,
      );
      const outputPath = resolve(input.sessionDir, relativePath);

      try {
        await downloadToPath({
          args: input.args,
          url,
          outputPath,
          authOverrides: {
            apiUsername: input.username,
          },
        });

        results.push({
          url,
          local_path: relativePath,
          post_id: post.id,
          post_number: post.post_number,
        });
      } catch (error) {
        results.push({
          url,
          post_id: post.id,
          post_number: post.post_number,
          download_error: error instanceof Error ? error.message : String(error),
        });
      }

      attachmentIndex += 1;
    }
  }

  return results;
}

function extractAttachmentUrls(baseUrl: string, cooked: string): string[] {
  const origin = new URL(baseUrl).origin;
  const candidates = new Set<string>();
  const pattern = /\b(?:href|src)=["']([^"']+)["']/g;

  for (const match of cooked.matchAll(pattern)) {
    const rawUrl = match[1];
    if (!rawUrl || rawUrl.startsWith("mailto:")) {
      continue;
    }

    let resolved: URL;
    try {
      resolved = new URL(rawUrl, origin);
    } catch {
      continue;
    }

    if (resolved.origin !== origin) {
      continue;
    }

    if (!isAttachmentPath(resolved.pathname)) {
      continue;
    }

    candidates.add(resolved.toString());
  }

  return [...candidates];
}

function isAttachmentPath(pathname: string): boolean {
  return (
    pathname.includes("/uploads/") ||
    pathname.includes("/optimized/") ||
    pathname.includes("/original/") ||
    pathname.includes("/secure-media-uploads/") ||
    pathname.includes("/discourse-ai/ai-bot/artifacts/")
  );
}

function resolveAttachmentPath(
  attachmentsDir: string,
  postNumber: number,
  attachmentIndex: number,
  url: string,
  usedPaths: Set<string>,
): string {
  const parsed = new URL(url);
  const baseName = basename(parsed.pathname) || "attachment";
  const extension = extname(baseName);
  const stem = slugify(
    extension ? baseName.slice(0, -extension.length) : baseName,
    "attachment",
  );

  let attempt = 0;
  while (true) {
    const suffix = attempt === 0 ? "" : `-${attempt + 1}`;
    const fileName =
      `${String(postNumber).padStart(3, "0")}-${String(attachmentIndex).padStart(2, "0")}` +
      `-${stem}${suffix}${extension}`;
    const absolutePath = resolve(attachmentsDir, fileName);
    if (!usedPaths.has(absolutePath)) {
      usedPaths.add(absolutePath);
      return `attachments/${fileName}`;
    }
    attempt += 1;
  }
}

function buildSessionDirName(topic: TopicResponse, posts: TopicPost[]): string {
  const title = topic.title ?? `conversation-${topic.id}`;
  const firstDate = formatDateSegment(posts[0]?.created_at ?? topic.created_at);
  const lastDate = formatDateSegment(posts.at(-1)?.created_at ?? topic.last_posted_at);
  const slug = slugify(title, `conversation-${topic.id}`).slice(0, SESSION_TITLE_LIMIT);
  return `${topic.id}-${slug}-${firstDate}-${lastDate}`;
}

function formatDateSegment(value?: string): string {
  if (!value) {
    return "unknown-date";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "unknown-date";
  }
  return date.toISOString().slice(0, 10);
}

function slugify(input: string, fallback: string): string {
  const normalized = input
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, " ")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return normalized || fallback;
}

function renderTranscriptMarkdown(input: {
  topic: TopicResponse;
  posts: TopicPost[];
  attachments: ExportedAttachment[];
}): string {
  const lines: string[] = [];
  const title = input.topic.title ?? `Conversation ${input.topic.id}`;

  lines.push(`# ${title}`);
  lines.push("");
  lines.push(`- Topic ID: ${input.topic.id}`);
  if (input.topic.slug) {
    lines.push(`- Slug: ${input.topic.slug}`);
  }
  lines.push(`- Started: ${input.posts[0]?.created_at ?? input.topic.created_at ?? "unknown"}`);
  lines.push(
    `- Last Activity: ${input.posts.at(-1)?.created_at ?? input.topic.last_posted_at ?? "unknown"}`,
  );
  lines.push(`- Messages: ${input.posts.length}`);
  lines.push(`- Attachments: ${input.attachments.length}`);
  lines.push("");

  for (const post of input.posts) {
    lines.push(`## ${post.post_number}. ${post.username ?? "unknown"} (${post.created_at ?? "unknown"})`);
    lines.push("");

    if (post.reply_to_post_number) {
      lines.push(`Reply To: ${post.reply_to_post_number}`);
      lines.push("");
    }

    lines.push(post.raw?.trim() || htmlToText(post.cooked ?? ""));
    lines.push("");

    const attachments = input.attachments.filter((item) => item.post_id === post.id);
    if (attachments.length > 0) {
      lines.push("Attachments:");
      for (const attachment of attachments) {
        lines.push(attachment.local_path ? `- ${attachment.local_path}` : `- ${attachment.url}`);
        if (attachment.download_error) {
          lines.push(`  download failed: ${attachment.download_error}`);
        }
      }
      lines.push("");
    }
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}

function getRequiredUserIdentifier(args: ParsedArgs): string {
  const userId = getOption(args, "user-id");
  const user = getOption(args, "user");
  const values = [userId, user].filter((value): value is string => Boolean(value));

  if (values.length === 0) {
    throw new Error("Missing --user-id or --user");
  }
  if (values.length > 1) {
    throw new Error("Use either --user-id or --user, not both");
  }

  const identifier = values[0].trim();
  if (!identifier) {
    throw new Error("User identifier must not be empty");
  }

  return identifier;
}

function parsePositiveInteger(value: string, key: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`--${key} must be a positive integer`);
  }
  return parsed;
}
