import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["core/**/test/**/*.test.ts", "modules/**/test/**/*.test.ts", "integrations/**/test/**/*.test.ts", "packages/**/test/**/*.test.ts?(x)"], testTimeout: 30000, hookTimeout: 60000, pool: "forks" } });
