import {
  Router,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from "express";
import { Prisma, Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "./db.js";
import {
  auth,
  allow,
  persistRefresh,
  refreshCookie,
  signAccess,
  type AuthUser,
} from "./auth.js";
import { config } from "./config.js";
import { projectFor, taskFor } from "./policy.js";
import {
  clientSchema,
  filters,
  loginSchema,
  projectSchema,
  statusSchema,
  taskSchema,
  userSchema,
} from "./validation.js";
import { emitActivity, emitNotification, presenceCount } from "./socket.js";

const asyncRoute =
  (
    fn: (req: Request, res: Response, next: NextFunction) => unknown,
  ): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);
const visibleProjects = (u: AuthUser): Prisma.ProjectWhereInput =>
  u.role === Role.ADMIN
    ? {}
    : u.role === Role.PM
      ? { ownerId: u.id }
      : { tasks: { some: { assigneeId: u.id } } };
export const api = Router();
api.post(
  "/auth/login",
  asyncRoute(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash)))
      return res.status(401).json({
        error: {
          code: "INVALID_CREDENTIALS",
          message: "Email or password is incorrect",
        },
      });
    const safe = { id: user.id, name: user.name, role: user.role };
    refreshCookie(res, await persistRefresh(safe));
    res.json({ accessToken: signAccess(safe), user: safe });
  }),
);
api.post(
  "/auth/refresh",
  asyncRoute(async (req, res) => {
    const token = req.cookies.refresh_token;
    try {
      const decoded = jwt.verify(token, config.refreshSecret) as { id: string };
      const rows = await prisma.refreshToken.findMany({
        where: {
          userId: decoded.id,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
      });
      const match = await Promise.all(
        rows.map(async (r) =>
          (await bcrypt.compare(token, r.tokenHash)) ? r : null,
        ),
      );
      const record = match.find(Boolean);
      if (!record) throw Error();
      await prisma.refreshToken.update({
        where: { id: record.id },
        data: { revokedAt: new Date() },
      });
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: decoded.id },
      });
      const safe = { id: user.id, name: user.name, role: user.role };
      refreshCookie(res, await persistRefresh(safe));
      res.json({ accessToken: signAccess(safe), user: safe });
    } catch {
      res.status(401).json({
        error: {
          code: "REFRESH_DENIED",
          message: "Session expired; please sign in",
        },
      });
    }
  }),
);
api.post(
  "/auth/logout",
  auth,
  asyncRoute(async (req, res) => {
    await prisma.refreshToken.updateMany({
      where: { userId: req.user!.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    res.clearCookie("refresh_token", { path: "/api/auth" }).status(204).end();
  }),
);
api.get("/me", auth, (req, res) => res.json({ user: req.user }));
api.get(
  "/clients",
  auth,
  allow(Role.ADMIN, Role.PM),
  asyncRoute(async (_req, res) =>
    res.json(await prisma.client.findMany({ orderBy: { name: "asc" } })),
  ),
);
api.post(
  "/clients",
  auth,
  allow(Role.ADMIN),
  asyncRoute(async (req, res) =>
    res
      .status(201)
      .json(await prisma.client.create({ data: clientSchema.parse(req.body) })),
  ),
);
api.get(
  "/users",
  auth,
  allow(Role.ADMIN),
  asyncRoute(async (_req, res) =>
    res.json(
      await prisma.user.findMany({
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      }),
    ),
  ),
);
api.post(
  "/users",
  auth,
  allow(Role.ADMIN),
  asyncRoute(async (req, res) => {
    const data = userSchema.parse(req.body);
    const passwordHash = await bcrypt.hash(data.password, 10);

    const user = await prisma.user.create({
      data: {
        name: data.name,
        email: data.email,
        role: data.role,
        passwordHash,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
      },
    });

    res.status(201).json(user);
  }),
);
api.get(
  "/users/developers",
  auth,
  allow(Role.ADMIN, Role.PM),
  asyncRoute(async (_req, res) =>
    res.json(
      await prisma.user.findMany({
        where: { role: Role.DEVELOPER },
        select: { id: true, name: true, email: true },
      }),
    ),
  ),
);
api.get(
  "/projects",
  auth,
  asyncRoute(async (req, res) =>
    res.json(
      await prisma.project.findMany({
        where: visibleProjects(req.user!),
        include: {
          client: true,
          owner: { select: { id: true, name: true } },
          _count: { select: { tasks: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
    ),
  ),
);
api.post(
  "/projects",
  auth,
  allow(Role.ADMIN, Role.PM),
  asyncRoute(async (req, res) => {
    const data = projectSchema.parse(req.body);
    res.status(201).json(
      await prisma.project.create({
        data: { ...data, ownerId: req.user!.id },
        include: { client: true },
      }),
    );
  }),
);
api.get(
  "/projects/:id",
  auth,
  asyncRoute(async (req, res) => {
    const p = await projectFor(req.user!, String(req.params.id));
    if (!p)
      return res
        .status(404)
        .json({ error: { code: "NOT_FOUND", message: "Project unavailable" } });
    res.json(
      await prisma.project.findUnique({
        where: { id: p.id },
        include: {
          client: true,
          owner: { select: { name: true } },
          tasks: {
            include: { assignee: { select: { id: true, name: true } } },
            orderBy: { dueDate: "asc" },
          },
        },
      }),
    );
  }),
);
api.get(
  "/projects/:id/tasks",
  auth,
  asyncRoute(async (req, res) => {
    const p = await projectFor(req.user!, String(req.params.id));
    if (!p)
      return res
        .status(404)
        .json({ error: { code: "NOT_FOUND", message: "Project unavailable" } });
    const f = filters.parse(req.query);
    res.json(
      await prisma.task.findMany({
        where: {
          projectId: p.id,
          ...(req.user!.role === Role.DEVELOPER
            ? { assigneeId: req.user!.id }
            : {}),
          ...(f.status ? { status: f.status } : {}),
          ...(f.priority ? { priority: f.priority } : {}),
          ...(f.dueFrom || f.dueTo
            ? {
                dueDate: {
                  ...(f.dueFrom ? { gte: f.dueFrom } : {}),
                  ...(f.dueTo ? { lte: f.dueTo } : {}),
                },
              }
            : {}),
        },
        include: { assignee: { select: { id: true, name: true } } },
        orderBy: [{ priority: "desc" }, { dueDate: "asc" }],
      }),
    );
  }),
);
api.post(
  "/projects/:id/tasks",
  auth,
  allow(Role.ADMIN, Role.PM),
  asyncRoute(async (req, res) => {
    const p = await projectFor(req.user!, String(req.params.id));
    if (!p || req.user!.role === Role.DEVELOPER)
      return res.status(403).json({
        error: { code: "FORBIDDEN", message: "Cannot manage this project" },
      });
    const data = taskSchema.parse(req.body);
    const task = await prisma.task.create({
      data: { ...data, projectId: p.id },
    });
    if (task.assigneeId) {
      const notification = await prisma.notification.create({
        data: {
          userId: task.assigneeId,
          taskId: task.id,
          message: `You were assigned: ${task.title}`,
        },
      });
      emitNotification(task.assigneeId, notification);
    }
    res.status(201).json(task);
  }),
);
api.patch(
  "/tasks/:id/status",
  auth,
  asyncRoute(async (req, res) => {
    const task = await taskFor(req.user!, String(req.params.id));
    if (!task)
      return res
        .status(404)
        .json({ error: { code: "NOT_FOUND", message: "Task unavailable" } });
    const { status } = statusSchema.parse(req.body);
    if (req.user!.role === Role.DEVELOPER && task.assigneeId !== req.user!.id)
      return res
        .status(403)
        .json({ error: { code: "FORBIDDEN", message: "Not your task" } });
    const old = task.status;
    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.task.update({
        where: { id: task.id },
        data: { status, isOverdue: status === "DONE" ? false : task.isOverdue },
      });
      const activity = await tx.activity.create({
        data: {
          projectId: task.projectId,
          taskId: task.id,
          actorId: req.user!.id,
          type: "STATUS_CHANGED",
          message: `${req.user!.name} moved ${task.title} from ${old} to ${status}`,
          metadata: { from: old, to: status },
        },
      });
      let notification = null;
      if (status === "IN_REVIEW") {
        notification = await tx.notification.create({
          data: {
            userId: task.project.ownerId,
            taskId: task.id,
            message: `${task.title} is ready for review`,
          },
        });
      }
      return { updated, activity, notification };
    });
    emitActivity(
      task.projectId,
      result.activity,
      task.project.ownerId,
      task.assigneeId,
    );
    if (result.notification)
      emitNotification(task.project.ownerId, result.notification);
    res.json(result.updated);
  }),
);
api.get(
  "/activities",
  auth,
  asyncRoute(async (req, res) => {
    const since = req.query.since
      ? new Date(String(req.query.since))
      : undefined;
    const projectWhere = visibleProjects(req.user!);
    const activities = await prisma.activity.findMany({
      where: {
        project: { is: projectWhere },
        ...(req.user!.role === Role.DEVELOPER
          ? { task: { is: { assigneeId: req.user!.id } } }
          : {}),
        ...(since ? { createdAt: { gt: since } } : {}),
      },
      include: {
        actor: { select: { name: true } },
        task: { select: { title: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    res.json(activities);
  }),
);
api.get(
  "/notifications",
  auth,
  asyncRoute(async (req, res) =>
    res.json(
      await prisma.notification.findMany({
        where: { userId: req.user!.id },
        orderBy: { createdAt: "desc" },
        take: 30,
      }),
    ),
  ),
);
api.patch(
  "/notifications/:id/read",
  auth,
  asyncRoute(async (req, res) =>
    res.json(
      await prisma.notification.updateMany({
        where: { id: String(req.params.id), userId: req.user!.id },
        data: { readAt: new Date() },
      }),
    ),
  ),
);
api.post(
  "/notifications/read-all",
  auth,
  asyncRoute(async (req, res) =>
    res.json(
      await prisma.notification.updateMany({
        where: { userId: req.user!.id, readAt: null },
        data: { readAt: new Date() },
      }),
    ),
  ),
);
api.get(
  "/dashboard",
  auth,
  asyncRoute(async (req, res) => {
    const u = req.user!;
    if (u.role === Role.ADMIN) {
      const [projects, tasks, overdue] = await Promise.all([
        prisma.project.count(),
        prisma.task.groupBy({ by: ["status"], _count: true }),
        prisma.task.count({ where: { isOverdue: true } }),
      ]);
      return res.json({ projects, tasks, overdue, online: presenceCount() });
    }
    if (u.role === Role.PM) {
      const start = new Date();
      const end = new Date(start);
      end.setDate(end.getDate() + 7);
      return res.json({
        projects: await prisma.project.count({ where: { ownerId: u.id } }),
        byPriority: await prisma.task.groupBy({
          by: ["priority"],
          where: { project: { ownerId: u.id } },
          _count: true,
        }),
        upcoming: await prisma.task.findMany({
          where: {
            project: { ownerId: u.id },
            dueDate: { gte: start, lte: end },
          },
          take: 10,
          orderBy: { dueDate: "asc" },
        }),
      });
    }
    return res.json({
      tasks: await prisma.task.findMany({
        where: { assigneeId: u.id },
        orderBy: [{ priority: "desc" }, { dueDate: "asc" }],
      }),
    });
  }),
);
