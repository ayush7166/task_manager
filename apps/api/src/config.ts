import dotenv from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
dotenv.config({
  path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env"),
});
const need = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};
export const config = {
  port: Number(process.env.PORT ?? 4000),
  origin: process.env.CLIENT_ORIGIN ?? "http://localhost:5173",
  accessSecret: need("JWT_ACCESS_SECRET"),
  refreshSecret: need("JWT_REFRESH_SECRET"),
  production: process.env.NODE_ENV === "production",
};
