import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests",
  timeout: 90000,
  retries: 0,
  use: {
    baseURL: `http://localhost:${process.env.TEST_PORT || 19737}`,
  },
});
