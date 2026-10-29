import { fileURLToPath } from "node:url";

export const localServerSecurity = {
  cors: false,
  allowedHosts: ["localhost"],
  headers: { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin" },
  fs: {
    strict: true,
    allow: [fileURLToPath(new URL("../", import.meta.url)), fileURLToPath(new URL("../../node_modules/", import.meta.url))],
    deny: ["**/.env", "**/.env.*", "**/.git/**", "**/frontend/data/**", "**/frontend/server/**", "**/cache/**", "**/.agents/**", "**/.codex/**"],
  },
};
