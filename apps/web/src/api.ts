import axios from "axios";
export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? "http://localhost:4000/api",
  withCredentials: true,
});
let access = "";
export const setAccess = (v: string) => (access = v);
api.interceptors.request.use((c) => {
  if (access) c.headers.Authorization = `Bearer ${access}`;
  return c;
});
