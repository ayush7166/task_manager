import cron from "node-cron";
import { prisma } from "./db.js";
export function startJobs() {
  cron.schedule("*/5 * * * *", async () => {
    await prisma.task.updateMany({
      where: {
        dueDate: { lt: new Date() },
        status: { not: "DONE" },
        isOverdue: false,
      },
      data: { isOverdue: true },
    });
  });
}
