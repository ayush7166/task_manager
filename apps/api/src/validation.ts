import { z } from "zod";
export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});
export const userSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(["ADMIN", "PM", "DEVELOPER"]),
});
export const clientSchema = z.object({ name: z.string().min(2).max(120) });
export const projectSchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(2000).optional(),
  clientId: z.string().cuid(),
});
export const taskSchema = z.object({
  title: z.string().min(2).max(200),
  description: z.string().max(5000).optional(),
  assigneeId: z.string().cuid().nullable().optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  dueDate: z.coerce.date(),
});
export const statusSchema = z.object({
  status: z.enum(["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE"]),
});
export const filters = z.object({
  status: z.enum(["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE"]).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
  dueFrom: z.coerce.date().optional(),
  dueTo: z.coerce.date().optional(),
});
