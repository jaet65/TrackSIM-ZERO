import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
  build: {
    outDir: "dist-electron",
    emptyOutDir: false,
    lib: {
      entry: path.resolve(import.meta.dirname, "electron/main.ts"),
      formats: ["cjs"],
      fileName: () => "main.cjs",
    },
    rollupOptions: {
      external: [
        "electron",
        "pg",
        "path",
        "fs",
        "crypto",
        "events",
        "stream",
        "util",
        "net",
        "tls",
        "dns",
        "string_decoder",
        "buffer",
        "os",
        "http"
      ],
    },
  },
});
