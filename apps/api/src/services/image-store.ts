// Local image persistence — development.md §0: images live in DATA_DIR/images.
// Shared by the raw upload route and the import pipeline (which downloads the
// provider's remote hero image once so nothing external is fetched at runtime).
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { ApiError } from "../middleware/error.js";

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

const MAX_BYTES = 10 * 1024 * 1024;

export function newImageName(mime: string): string {
  const ext = EXT_BY_MIME[mime];
  if (!ext) throw new ApiError(415, "unsupported_media_type", "Send image/jpeg, image/png, image/webp or image/gif");
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
}

export async function writeImage(name: string, buf: Buffer): Promise<string> {
  if (buf.length > MAX_BYTES) throw new ApiError(413, "payload_too_large", "Max 10 MB");
  await fs.writeFile(path.join(config.imagesDir, name), buf);
  return `/images/${name}`;
}

/** Download a remote image (user-initiated import per §0) into local storage. */
export async function saveImageFromUrl(remoteUrl: string): Promise<string | null> {
  let res: Response;
  try {
    res = await fetch(remoteUrl);
  } catch {
    return null; // hero image is cosmetic — a failed download must not fail the import
  }
  if (!res.ok) return null;
  const mime = res.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
  if (!EXT_BY_MIME[mime]) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) return null;
  return writeImage(newImageName(mime), buf);
}
