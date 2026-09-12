import { PrismaClient, Priority, Role, TaskStatus } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();
const passwordHash = await bcrypt.hash("Password123!", 10);
const definitions = [
  ["Admin", "admin@velozity.dev", Role.ADMIN],
  ["Priya PM", "pm1@velozity.dev", Role.PM],
  ["Marcus PM", "pm2@velozity.dev", Role.PM],
  ["Ravi Dev", "dev1@velozity.dev", Role.DEVELOPER],
  ["Elena Dev", "dev2@velozity.dev", Role.DEVELOPER],
  ["Noah Dev", "dev3@velozity.dev", Role.DEVELOPER],
  ["Aisha Dev", "dev4@velozity.dev", Role.DEVELOPER],
];
try {
  await prisma.activity.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.task.deleteMany();
  await prisma.project.deleteMany();
  await prisma.client.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany();
  const users = await Promise.all(
    definitions.map(([name, email, role]) =>
      prisma.user.create({ data: { name, email, role, passwordHash } }),
    ),
  );
  const [, pm1, pm2, ...developers] = users;
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
          name,
          description: "Seeded client project",
          ownerId: owner.id,
          clientId: client.id,
        },
      }),
    ),
  );
  const priorities = [
    Priority.LOW,
    Priority.MEDIUM,
    Priority.HIGH,
    Priority.CRITICAL,
    Priority.MEDIUM,
  ];
  const taskStatuses = [
    TaskStatus.TODO,
    TaskStatus.IN_PROGRESS,
    TaskStatus.IN_REVIEW,
    TaskStatus.DONE,
    TaskStatus.TODO,
  ];
  for (const [projectIndex, project] of projects.entries())
    for (let taskIndex = 0; taskIndex < 5; taskIndex++) {
      const assignee =
        developers[(projectIndex + taskIndex) % developers.length];
      const status = taskStatuses[taskIndex];
      const owner = projectIndex === 2 ? pm2 : pm1;
      const overdue = taskIndex === 0 && projectIndex < 2;
      const task = await prisma.task.create({
        data: {
          title: `${project.name} task ${taskIndex + 1}`,
          description: "A seeded task for demonstration",
          projectId: project.id,
          assigneeId: assignee.id,
          status,
          priority: priorities[taskIndex],
          dueDate: new Date(
            Date.now() + (overdue ? -3 : 5 + taskIndex) * 86400000,
          ),
          isOverdue: overdue,
        },
      });
      await prisma.activity.create({
        data: {
          projectId: project.id,
          taskId: task.id,
          actorId: owner.id,
          type: "STATUS_CHANGED",
          message: `${owner.name} moved ${task.title} from TODO to ${status}`,
          metadata: { from: "TODO", to: status },
        },
      });
    }
  await prisma.notification.create({
    data: {
      userId: developers[0].id,
      message: "Welcome to the project dashboard",
    },
  });
  console.log("Seed complete");
} finally {
  await prisma.$disconnect();
}
