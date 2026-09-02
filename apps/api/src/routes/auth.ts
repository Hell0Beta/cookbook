// POST /auth/signup | /auth/login — username-only (development.md §0, §11).
import { Router } from "express";
import { LoginInput, SignupInput } from "@cookbook/shared";
import { prisma } from "../db.js";
import { createSessionToken, setSessionCookie } from "../auth/session.js";
import { ApiError } from "../middleware/error.js";

export const authRouter = Router();

function toApiUser(u: { id: string; username: string; displayName: string; avatarUrl: string | null; createdAt: Date }) {
  return {
    id: u.id,
    username: u.username,
    display_name: u.displayName,
    avatar_url: u.avatarUrl,
    created_at: u.createdAt.toISOString(),
  };
}

authRouter.post("/signup", async (req, res, next) => {
  try {
    const input = SignupInput.parse(req.body);
    const existing = await prisma.user.findUnique({ where: { username: input.username } });
    if (existing) {
      throw new ApiError(409, "username_taken", "That username is already in use");
    }
    const user = await prisma.user.create({
      data: {
        username: input.username,
        displayName: input.display_name ?? input.username,
      },
    });
    setSessionCookie(res, createSessionToken(user.id));
    res.status(201).json(toApiUser(user));
  } catch (err) {
    next(err);
  }
});

authRouter.post("/login", async (req, res, next) => {
  try {
    const input = LoginInput.parse(req.body);
    const user = await prisma.user.findUnique({ where: { username: input.username } });
    if (!user) {
      throw new ApiError(404, "user_not_found", "No user with that username — sign up first");
    }
    setSessionCookie(res, createSessionToken(user.id));
    res.json(toApiUser(user));
  } catch (err) {
    next(err);
  }
});
