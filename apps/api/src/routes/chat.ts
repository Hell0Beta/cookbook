// POST /chat/sessions · GET /chat/sessions/:id · POST /chat/sessions/:id/messages
// · POST /chat/sessions/:id/log (development.md §11, §14). Session persistence
// + LLM turn hosting; the router logic that resolves recipe-bound intents
// client-side (§14.2) never reaches these routes except to be logged.
//
// Session semantics (design.md §3.3.4): ONE transcript per meal occasion —
// sessions resolve by occasion key alone so switching recipe tabs keeps the
// conversation; plain (no-occasion) recipe views key on recipe id.
import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../auth/session.js";
import { ApiError } from "../middleware/error.js";
import {
  CHAT_QUOTA_NOTICE,
  CreateChatSessionInput,
  ChatLogInput,
  ChatMessageInput,
  type ChatMessage,
  type CookingSession,
  type ChatTurnMessage,
} from "@cookbook/shared";
import { buildRecipeContext, generateChatReply, getVisibleRecipe } from "../services/chat.js";
import type { ChatMessage as ChatMessageRow, CookingSession as CookingSessionRow } from "@prisma/client";

export const chatRouter = Router();
chatRouter.use(requireAuth);

// ── serialization (shared snake_case shapes) ─────────────────────────────────

function serializeSession(s: CookingSessionRow): CookingSession {
  return {
    id: s.id,
    user_id: s.userId,
    recipe_id: s.recipeId,
    occasion_key: s.occasionKey,
    started_at: s.startedAt.toISOString(),
    ended_at: s.endedAt?.toISOString() ?? null,
    last_seen_at: s.lastSeenAt.toISOString(),
  };
}

function serializeMessage(m: ChatMessageRow): ChatMessage {
  return {
    id: m.id,
    cooking_session_id: m.cookingSessionId,
    role: m.role as ChatMessage["role"],
    content: m.content,
    intent: (m.intent as ChatMessage["intent"]) ?? null,
    created_at: m.createdAt.toISOString(),
  };
}

// ── helpers ──────────────────────────────────────────────────────────────────

async function getOwnSession(sessionId: string, userId: string): Promise<CookingSessionRow> {
  const session = await prisma.cookingSession.findFirst({ where: { id: sessionId, userId } });
  if (!session) throw new ApiError(404, "not_found");
  return session;
}

// "Resume today's session for the occasion" (development.md §14.4, design.md
// §3.3.4): ONE conversation per occasion — switching recipe tabs keeps the
// transcript, so occasions resolve by occasion key alone; plain (no-occasion)
// recipe views resolve by recipe. Same-day window.
async function findTodaysSession(
  userId: string,
  recipeId: string,
  occasionKey: string | null,
): Promise<CookingSessionRow | null> {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  return prisma.cookingSession.findFirst({
    where: {
      userId,
      endedAt: null,
      lastSeenAt: { gte: startOfToday },
      ...(occasionKey !== null
        ? { occasionKey }
        : { occasionKey: null, recipeId }),
    },
    orderBy: { lastSeenAt: "desc" },
  });
}

// ── routes ───────────────────────────────────────────────────────────────────

// POST /chat/sessions — resolve or create today's session for the occasion.
chatRouter.post("/sessions", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = CreateChatSessionInput.parse(req.body);
    const recipe = await getVisibleRecipe(req.userId!, input.recipe_id);
    if (!recipe) throw new ApiError(404, "not_found");

    const occasionKey = input.occasion_key ?? null;
    const existing = await findTodaysSession(req.userId!, input.recipe_id, occasionKey);

    if (existing && input.fresh) {
      // "Start fresh": end the old conversation, fall through to a new session.
      await prisma.cookingSession.update({ where: { id: existing.id }, data: { endedAt: new Date() } });
    } else if (existing) {
      const [session, messages] = await prisma.$transaction([
        prisma.cookingSession.update({
          where: { id: existing.id },
          data: { lastSeenAt: new Date() },
        }),
        prisma.chatMessage.findMany({
          where: { cookingSessionId: existing.id },
          orderBy: { createdAt: "asc" },
        }),
      ]);
      res.json({
        session: serializeSession(session),
        messages: messages.map(serializeMessage),
        resumed: true,
      });
      return;
    }

    const session = await prisma.cookingSession.create({
      data: {
        userId: req.userId!,
        recipeId: input.recipe_id,
        occasionKey: input.occasion_key ?? null,
      },
    });
    res.status(201).json({ session: serializeSession(session), messages: [], resumed: false });
  } catch (err) {
    next(err);
  }
});

// GET /chat/sessions/:id — transcript for session resume.
chatRouter.get("/sessions/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = await getOwnSession(req.params.id!, req.userId!);
    const messages = await prisma.chatMessage.findMany({
      where: { cookingSessionId: session.id },
      orderBy: { createdAt: "asc" },
    });
    res.json({ session: serializeSession(session), messages: messages.map(serializeMessage), resumed: true });
  } catch (err) {
    next(err);
  }
});

// POST /chat/sessions/:id/messages — one LLM turn (development.md §14.3):
// persist the user message FIRST (the transcript survives quota exhaustion),
// then complete, then persist the reply. On quota, persist the spoken fallback
// notice with intent llm_fallback and still return the §11 429 convention —
// the client renders CHAT_QUOTA_NOTICE (the exact persisted text) locally.
chatRouter.post("/sessions/:id/messages", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = ChatMessageInput.parse(req.body);
    const session = await getOwnSession(req.params.id!, req.userId!);
    if (session.endedAt) throw new ApiError(409, "session_ended");

    const userMessage = await prisma.chatMessage.create({
      data: { cookingSessionId: session.id, role: "user", content: input.content },
    });

    // The active tab's recipe (multi-recipe occasions): this turn's context
    // follows it, and it becomes the session's anchor recipe.
    const activeRecipeId = input.recipe_id ?? session.recipeId;

    try {
      const [recipe, history] = await Promise.all([
        getVisibleRecipe(req.userId!, activeRecipeId),
        prisma.chatMessage.findMany({
          where: { cookingSessionId: session.id, createdAt: { lt: userMessage.createdAt } },
          orderBy: { createdAt: "desc" },
          take: 16, // last ~8 exchanges; reversed below to oldest-first
        }),
      ]);
      if (!recipe) throw new ApiError(404, "not_found");

      const historyTurns: ChatTurnMessage[] = history
        .slice()
        .reverse()
        .filter((m) => m.intent !== "quota_notice")
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

      const replyText = await generateChatReply(
        buildRecipeContext(recipe, input.context),
        historyTurns,
        input.content,
      );
      const reply = await prisma.chatMessage.create({
        data: { cookingSessionId: session.id, role: "assistant", content: replyText, intent: "llm" },
      });
      await prisma.cookingSession.update({
        where: { id: session.id },
        data: { lastSeenAt: new Date(), ...(activeRecipeId !== session.recipeId ? { recipeId: activeRecipeId } : {}) },
      });
      res.status(201).json({
        user_message: serializeMessage(userMessage),
        reply: serializeMessage(reply),
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        // The user message is already persisted — log the spoken fallback so the
        // resumed transcript shows what was actually said (§14.3).
        await prisma.chatMessage.create({
          data: {
            cookingSessionId: session.id,
            role: "assistant",
            content: CHAT_QUOTA_NOTICE,
            intent: "llm_fallback",
          },
        });
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

// POST /chat/sessions/:id/log — fire-and-forget persistence of client-resolved
// router turns + proactive notices (§14.2); never calls the LLM.
chatRouter.post("/sessions/:id/log", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = ChatLogInput.parse(req.body);
    const session = await getOwnSession(req.params.id!, req.userId!);
    const message = await prisma.chatMessage.create({
      data: {
        cookingSessionId: session.id,
        role: input.role,
        content: input.content,
        intent: input.intent,
      },
    });
    await prisma.cookingSession.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date() },
    });
    res.status(201).json(serializeMessage(message));
  } catch (err) {
    next(err);
  }
});
