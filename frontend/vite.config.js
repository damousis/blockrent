import { defineConfig } from "vite";
import { createCataloguePlugin } from "./server/catalogue.js";
import { localServerSecurity } from "./server/server-config.js";

export default defineConfig({
  plugins: [createCataloguePlugin()],
  server: { ...localServerSecurity, host: "127.0.0.1", port: 5173, strictPort: true },
  preview: { host: "127.0.0.1", port: 4173, strictPort: true, cors: false, allowedHosts: ["localhost"], headers: localServerSecurity.headers },
});
