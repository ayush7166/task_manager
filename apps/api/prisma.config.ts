import { config } from "dotenv";
import { defineConfig, env } from "prisma/config";

// The shared local configuration belongs at the repository root.
config({ path: "../../.env" });

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: { url: env("DATABASE_URL") },
});
