// Tag routes — development.md §11: GET /tags nested filter tree, POST /tags
// custom user tag. System tags (userId null) are created by the TaggingService.
import { Router, type Request, type Response, type NextFunction } from "express";
import { CreateTagInput } from "@cookbook/shared";
import { prisma } from "../db.js";
import { requireAuth } from "../auth/session.js";
import { ApiError } from "../middleware/error.js";

export const tagsRouter = Router();
tagsRouter.use(requireAuth);

// GET /tags — system tags + the caller's custom tags, nested by parent_tag_id.
tagsRouter.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tags = await prisma.tag.findMany({
      where: { OR: [{ userId: null }, { userId: req.userId }] },
      orderBy: [{ tagType: "asc" }, { label: "asc" }],
    });
    interface TagTreeNode {
      id: string;
      label: string;
      parent_tag_id: string | null;
      tag_type: string;
      children: TagTreeNode[];
    }
    const nodes = new Map<string, TagTreeNode>(
      tags.map((t) => [t.id, { id: t.id, label: t.label, parent_tag_id: t.parentTagId, tag_type: t.tagType, children: [] }]),
    );
    const roots: TagTreeNode[] = [];
    for (const t of tags) {
      const node = nodes.get(t.id)!;
      const parent = t.parentTagId ? nodes.get(t.parentTagId) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    res.json(roots);
  } catch (err) {
    next(err);
  }
});

// POST /tags — custom user tag (custom tag_type unless told otherwise).
tagsRouter.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = CreateTagInput.parse(req.body);
    const dupe = await prisma.tag.findFirst({
      where: { label: body.label, tagType: body.tag_type, OR: [{ userId: null }, { userId: req.userId }] },
    });
    if (dupe) throw new ApiError(409, "tag_exists");
    const tag = await prisma.tag.create({
      data: { label: body.label, tagType: body.tag_type, parentTagId: body.parent_tag_id, userId: req.userId },
    });
    res.status(201).json({ id: tag.id, label: tag.label, parent_tag_id: tag.parentTagId, tag_type: tag.tagType });
  } catch (err) {
    next(err);
  }
});
