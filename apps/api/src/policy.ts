import { Role } from "@prisma/client";
import { prisma } from "./db.js";
import type { AuthUser } from "./auth.js";
export async function projectFor(user: AuthUser, projectId: string) {
  const p = await prisma.project.findUnique({ where: { id: projectId } });
  if (!p) return null;
  if (
    user.role === Role.ADMIN ||
    (user.role === Role.PM && p.ownerId === user.id)
  )
    return p;
  if (
    user.role === Role.DEVELOPER &&
    (await prisma.task.findFirst({ where: { projectId, assigneeId: user.id } }))
  )
    return p;
  return null;
}
export async function taskFor(user: AuthUser, taskId: string, manage = false) {
  const t = await prisma.task.findUnique({
    where: { id: taskId },
    include: { project: true },
  });
  if (!t) return null;
  if (user.role === Role.ADMIN) return t;
  if (user.role === Role.PM && t.project.ownerId === user.id) return t;
  if (!manage && user.role === Role.DEVELOPER && t.assigneeId === user.id)
    return t;
  return null;
}
