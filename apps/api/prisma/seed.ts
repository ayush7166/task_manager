import { PrismaClient, Priority, Role, TaskStatus } from "@prisma/client";
import bcrypt from "bcryptjs";
const prisma = new PrismaClient();
async function main() {
  await prisma.activity.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.task.deleteMany();
  await prisma.project.deleteMany();
  await prisma.client.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany();
  const hash = await bcrypt.hash("Password123!", 10);
  const users = await Promise.all(
    [
      ["Admin", "admin@velocity.dev", Role.ADMIN],
      ["Priya PM", "pm1@velocity.dev", Role.PM],
      ["Marcus PM", "pm2@velocity.dev", Role.PM],
      ["Ravi Dev", "dev1@velocity.dev", Role.DEVELOPER],
      ["Elena Dev", "dev2@velocity.dev", Role.DEVELOPER],
      ["Noah Dev", "dev3@velocity.dev", Role.DEVELOPER],
      ["Aisha Dev", "dev4@velocity.dev", Role.DEVELOPER],
    ].map(([name, email, role]) =>
      prisma.user.create({
        data: {
          name: name as string,
          email: email as string,
          role: role as Role,
          passwordHash: hash,
        },
      }),
    ),
  );
  const [admin, pm1, pm2, ...devs] = users;
  const clients = await Promise.all(
    ["Northstar Retail", "Apex Health", "Lumina Finance"].map((name) =>
      prisma.client.create({ data: { name } }),
    ),
  );
  const projects = await Promise.all(
    [
      ["Storefront Refresh", pm1, clients[0]],
      ["Patient Portal", pm1, clients[1]],
      ["Investor Dashboard", pm2, clients[2]],
    ].map(([name, owner, client]) =>
      prisma.project.create({
        data: {
          name: name as string,
          ownerId: (owner as any).id,
          clientId: (client as any).id,
          description: "Seeded client project",
        },
      }),
    ),
  );
  for (const [pi, p] of projects.entries()) {
    for (let i = 0; i < 5; i++) {
      const assignee = devs[(pi + i) % devs.length];
      const status = [
        TaskStatus.TODO,
        TaskStatus.IN_PROGRESS,
        TaskStatus.IN_REVIEW,
        TaskStatus.DONE,
        TaskStatus.TODO,
      ][i];
      const task = await prisma.task.create({
        data: {
          title: `${p.name} task ${i + 1}`,
          description: "A seeded task for demonstration",
          projectId: p.id,
          assigneeId: assignee.id,
          status,
          priority: [
            Priority.LOW,
            Priority.MEDIUM,
            Priority.HIGH,
            Priority.CRITICAL,
            Priority.MEDIUM,
          ][i],
          dueDate: new Date(
            Date.now() + (i === 0 && pi < 2 ? -3 : 5 + i) * 864e5,
          ),
          isOverdue: i === 0 && pi < 2,
        },
      });
      await prisma.activity.create({
        data: {
          projectId: p.id,
          taskId: task.id,
          actorId: pi === 2 ? pm2.id : pm1.id,
          type: "STATUS_CHANGED",
          message: `${pi === 2 ? pm2.name : pm1.name} moved ${task.title} from TODO to ${status}`,
          metadata: { from: "TODO", to: status },
        },
      });
    }
  }
  await prisma.notification.create({
    data: { userId: devs[0].id, message: "Welcome to the project dashboard" },
  });
  console.log("Seed complete");
}
main().finally(() => prisma.$disconnect());
