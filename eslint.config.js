import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import sonarjs from "eslint-plugin-sonarjs";
import typescript from "typescript-eslint";

export default defineConfig([
  {
    ignores: ["dist/**", "node_modules/**", ".ladybug*/**"]
  },
  eslint.configs.recommended,
  typescript.configs.recommended,
  sonarjs.configs.recommended,
]);
