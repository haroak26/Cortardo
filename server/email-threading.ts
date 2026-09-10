const messageIdCache = new Map<string, { threadId?: string | null } | undefined>();
const CACHE_TTL = 60_000;

function getCached(
  messageId: string,
): { threadId?: string | null } | undefined {
  const entry = messageIdCache.get(messageId);
  if (entry === undefined) return undefined;
  if (Date.now() - (entry as any)._ts > CACHE_TTL) {
    messageIdCache.delete(messageId);
    return undefined;
  }
  return entry;
}

function setCached(
  messageId: string,
  result: { threadId?: string | null } | undefined,
): void {
  if (!result) return;
  (result as any)._ts = Date.now();
  messageIdCache.set(messageId, result);
  if (messageIdCache.size > 1000) {
    const oldest = messageIdCache.entries().next().value;
    if (oldest) messageIdCache.delete(oldest[0]);
  }
}

export function clearThreadingCache(): void {
  messageIdCache.clear();
}

export function normalizeMessageId(value?: string | null): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim().replace(/^<+|>+$/g, "");
  return normalized.length > 0 ? normalized : undefined;
}

export function parseReferenceIds(references?: string | null): string[] {
  if (!references) return [];
  return references
    .split(/\s+/)
    .map((part) => normalizeMessageId(part))
    .filter((part): part is string => Boolean(part));
}

export function normalizeReferencesForStorage(references?: string | null): string | undefined {
  const normalized = parseReferenceIds(references);
  return normalized.length > 0 ? normalized.join(" ") : undefined;
}

export function formatMessageIdForHeader(value?: string | null): string | undefined {
  const normalized = normalizeMessageId(value);
  return normalized ? `<${normalized}>` : undefined;
}

export function formatReferencesForHeader(references?: string | null): string | undefined {
  const normalized = parseReferenceIds(references);
  return normalized.length > 0 ? normalized.map((part) => `<${part}>`).join(" ") : undefined;
}

export type ThreadSource = "in_reply_to" | "parent_match" | "self_seed";

export type ThreadingResolution = {
  threadId: string;
  threadSource: ThreadSource;
  parentMessageId?: string;
};

export async function resolveInboundThreading(
  messageId: string,
  inReplyTo: string | undefined,
  references: string | undefined,
  findLocalByMessageId: (messageId: string) => Promise<{ threadId?: string | null } | undefined>,
): Promise<ThreadingResolution> {
  const normalizedMessageId = normalizeMessageId(messageId) ?? messageId.trim();
  const normalizedInReplyTo = normalizeMessageId(inReplyTo);
  const referenceIds = parseReferenceIds(references);

  if (normalizedInReplyTo) {
    const cached = getCached(normalizedInReplyTo);
    const directParent = cached !== undefined ? cached : await findLocalByMessageId(normalizedInReplyTo);
    if (cached === undefined) setCached(normalizedInReplyTo, directParent);
    if (directParent) {
      return {
        threadId: directParent.threadId ?? normalizedInReplyTo,
        threadSource: "in_reply_to",
        parentMessageId: normalizedInReplyTo,
      };
    }
  }

  const uncached: string[] = [];
  for (let i = referenceIds.length - 1; i >= 0; i--) {
    const candidate = referenceIds[i];
    const cached = getCached(candidate);
    if (cached !== undefined) {
      if (cached) {
        return {
          threadId: cached.threadId ?? candidate,
          threadSource: "parent_match",
          parentMessageId: candidate,
        };
      }
    } else {
      uncached.push(candidate);
    }
  }

  if (uncached.length > 0) {
    const results = await Promise.all(
      uncached.map((id) => findLocalByMessageId(id)),
    );
    for (let i = 0; i < uncached.length; i++) {
      setCached(uncached[i], results[i]);
    }
    for (let i = uncached.length - 1; i >= 0; i--) {
      const candidate = uncached[i];
      const parent = results[i];
      if (parent) {
        return {
          threadId: parent.threadId ?? candidate,
          threadSource: "parent_match",
          parentMessageId: candidate,
        };
      }
    }
  }

  return {
    threadId: normalizedMessageId,
    threadSource: "self_seed",
  };
}
