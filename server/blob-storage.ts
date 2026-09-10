import type { PutBlobResult } from "@vercel/blob";

const BLOB_TOKEN_ENV = "BLOB_READ_WRITE_TOKEN";

function hasBlobToken(): boolean {
  try {
    return !!process.env[BLOB_TOKEN_ENV];
  } catch {
    return false;
  }
}

async function getBlob() {
  return import("@vercel/blob");
}

export async function uploadBlob(options: {
  pathname: string;
  body: string | Buffer;
  contentType?: string;
}): Promise<{ url: string; pathname: string }> {
  if (hasBlobToken()) {
    const { put } = await getBlob();
    const result: PutBlobResult = await put(options.pathname, options.body, {
      access: "public",
      contentType: options.contentType,
      addRandomSuffix: false,
    });
    return { url: result.url, pathname: result.pathname };
  }

  const { writeFile, mkdir } = await import("fs/promises");
  const { resolve, dirname } = await import("path");
  const filePath = resolve(process.cwd(), "uploads", options.pathname);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, options.body);
  return { url: `/uploads/${options.pathname}`, pathname: options.pathname };
}

export async function deleteBlob(url: string): Promise<void> {
  if (!url) return;

  if (hasBlobToken() && (url.startsWith("http://") || url.startsWith("https://"))) {
    const { del } = await getBlob();
    await del(url);
    return;
  }

  if (url.startsWith("/uploads/")) {
    const { unlink } = await import("fs/promises");
    const { resolve } = await import("path");
    await unlink(resolve(process.cwd(), url)).catch(() => {});
  }
}
