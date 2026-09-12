import { Server } from "socket.io";
import type { Server as HttpServer } from "http";
import { config } from "./config.js";
import { verifyAccess, type AuthUser } from "./auth.js";
import { projectFor } from "./policy.js";
export const online = new Set<string>();
let io: Server;
export function setupSocket(server: HttpServer) {
  io = new Server(server, {
    cors: { origin: config.origin, credentials: true },
  });
  io.use((socket, next) => {
    try {
      socket.data.user = verifyAccess(socket.handshake.auth.token);
      next();
    } catch {
      next(new Error("unauthorized"));
    }
  });
  io.on("connection", (socket) => {
    const user = socket.data.user as AuthUser;
    online.add(user.id);
    socket.join(`user:${user.id}`);
    socket.join(`role:${user.role}`);
    io.emit("presence", online.size);
    socket.on("project:join", async (projectId: string, reply?: Function) => {
      reply?.({ ok: Boolean(await projectFor(user, projectId)) });
    });
    socket.on("disconnect", () => {
      if (
        ![...io.sockets.sockets.values()].some(
          (s) => s.data.user?.id === user.id,
        )
      )
        online.delete(user.id);
      io.emit("presence", online.size);
    });
  });
  return io;
}
export const emitActivity = (
  _projectId: string,
  event: unknown,
  ownerId: string,
  assigneeId?: string | null,
) => {
  io.to("role:ADMIN").emit("activity:new", event);
  io.to(`user:${ownerId}`).emit("activity:new", event);
  if (assigneeId) io.to(`user:${assigneeId}`).emit("activity:new", event);
};
export const emitNotification = (userId: string, event: unknown) =>
  io.to(`user:${userId}`).emit("notification:new", event);
export const presenceCount = () => online.size;
