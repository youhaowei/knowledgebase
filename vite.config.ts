import { defineConfig } from "vite";
import { resolve } from "path";
import tsConfigPaths from "vite-tsconfig-paths";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  server: {
    port: 8000,
  },
  resolve: {
    alias: {
      // Force single React instance — prevents dual-React when using linked @stdui/react
      react: resolve("node_modules/react"),
      "react-dom": resolve("node_modules/react-dom"),
    },
  },
  plugins: [
    tsConfigPaths(),
    tanstackStart(),
    // react's vite plugin must come after start's vite plugin
    viteReact(),
    tailwindcss(),
  ],
});
