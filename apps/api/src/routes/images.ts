// Local image storage — development.md §0: no S3; images live in DATA_DIR/images
// and are served through this route.
import fs from "node:fs/promises";
import path from "node:path";
import { Router, type Request, type Response, type NextFunction } from "express";
import { config } from "../config.js";
import { requireAuth } from "../auth/session.js";
import { ApiError } from "../middleware/error.js";

export const imagesRouter = Router();

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

// GET /images/:filename — serve stored images (auth'd; single trusted-home-network user base).
imagesRouter.get("/:filename", (req: Request, res: Response, next: NextFunction) => {
  const filename = path.basename(req.params.filename!); // no traversal
  res.sendFile(path.join(config.imagesDir, filename), (err) => {
    if (err) next(new ApiError(404, "image_not_found"));
  });
});

// POST /images — upload (multipart body is raw bytes + content-type header for
// simplicity at this scale; a multipart lib can come later if needed).
imagesRouter.post(
  "/",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const mime = req.headers["content-type"] ?? "";
      const ext = EXT_BY_MIME[mime];
      if (!ext) {
        throw new ApiError(415, "unsupported_media_type", "Send image/jpeg, image/png, image/webp or image/gif");
      }
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(chunk as Buffer);
      }
      const buf = Buffer.concat(chunks);
      if (buf.length > 10 * 1024 * 1024) {
        throw new ApiError(413, "payload_too_large", "Max 10 MB");
      }
      const name = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
      await fs.writeFile(path.join(config.imagesDir, name), buf);
      res.status(201).json({ url: `/images/${name}` });
    } catch (err) {
      next(err);
    }
  },
);
