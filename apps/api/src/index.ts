import express from "express";
import http from "http";
import cors from "cors";
import cookieParser from "cookie-parser";
import { ZodError } from "zod";
import { config } from "./config.js";
import { api } from "./routes.js";
import { setupSocket } from "./socket.js";
import { startJobs } from "./jobs.js";
const app = express();
app.use(cors({ origin: config.origin, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.use("/api", api);
app.use((err: any, _req: any, res: any, _next: any) => {
  if (err instanceof ZodError)
    return res
      .status(400)
      .json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid request",
          details: err.flatten(),
        },
      });
  console.error(err);
  res
    .status(500)
    .json({
      error: { code: "INTERNAL_ERROR", message: "Unexpected server error" },
    });
});
const server = http.createServer(app);
setupSocket(server);
startJobs();
server.listen(config.port, () =>
  console.log(`API listening on ${config.port}`),
);
