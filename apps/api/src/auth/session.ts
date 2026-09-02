// Username-only auth with a signed session cookie (development.md §0).
import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { config } from "../config.js";

export const SESSION_COOKIE = "cookbook_session";

const DAY_MS = 86_400_000;

function sign(payload: string): string {
  return crypto.createHmac("sha256", config.sessionSecret).update(payload).digest("base64url");
}

/** Opaque token: "<userId>.<expiryMs>.<hmac>" — long-lived per development.md §0. */
export function createSessionToken(userId: string, ttlDays = 365): string {
  const expiry = Date.now() + ttlDays * DAY_MS;
  const payload = `${userId}.${expiry}`;
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token: string | undefined): string | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [userId, expiryStr, mac] = parts as [string, string, string];
  const payload = `${userId}.${expiryStr}`;
  const expected = sign(payload);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (Number(expiryStr) < Date.now()) return null;
  return userId;
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 365 * DAY_MS,
    // secure: true when served over HTTPS on the homeserver (behind a reverse proxy)
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE);
}

// Express augmentation for req.userId
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const userId = verifySessionToken(req.cookies?.[SESSION_COOKIE]);
  if (!userId) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  req.userId = userId;
  next();
}
