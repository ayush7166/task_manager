import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { Role } from "@prisma/client";
export type AuthUser = { id: string; role: Role; name: string };
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}
export const signAccess = (u: AuthUser) =>
  jwt.sign(u, config.accessSecret, { expiresIn: "15m" });
export const signRefresh = (u: AuthUser) =>
  jwt.sign({ id: u.id, role: u.role }, config.refreshSecret, {
    expiresIn: "7d",
  });
export const verifyAccess = (token: string) =>
  jwt.verify(token, config.accessSecret) as AuthUser;
export const auth = (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) throw Error();
    req.user = verifyAccess(token);
    next();
  } catch {
    res.status(401).json({
      error: {
        code: "UNAUTHENTICATED",
        message: "Valid access token required",
      },
    });
  }
};
export const allow =
  (...roles: Role[]) =>
  (req: Request, res: Response, next: NextFunction) =>
    req.user && roles.includes(req.user.role)
      ? next()
      : res
          .status(403)
          .json({ error: { code: "FORBIDDEN", message: "Insufficient role" } });
export async function persistRefresh(user: AuthUser) {
  const token = signRefresh(user);
  await prisma.refreshToken.create({
    data: {
      tokenHash: await bcrypt.hash(token, 10),
      userId: user.id,
      expiresAt: new Date(Date.now() + 7 * 864e5),
    },
  });
  return token;
}
export const refreshCookie = (res: Response, token: string) =>
  res.cookie("refresh_token", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.production,
    path: "/api/auth",
  });
