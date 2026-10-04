#!/usr/bin/env node
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
if (process.platform !== "darwin" || process.arch !== "arm64")
  throw new Error("Build on an Apple Silicon Mac.");
const env = {
  ...process.env,
  CI: "1",
  APP_VARIANT: "codely",
  CSC_IDENTITY_AUTO_DISCOVERY: "false",
};
async function run(command, args, cwd = root, extraEnv = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...env, ...extraEnv },
      stdio: "inherit",
      shell: false,
    });
    child.on("error", reject);
    child.once("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`${command} failed (${code})`));
        return;
      }
      resolve();
    });
  });
}
await run("npm", ["run", "build:app-deps"]);
await run("npm", ["run", "build:server"]);
await run("npm", ["run", "build:daemon-web-ui"]);
await run("npx", ["expo", "export", "--platform", "web"], path.join(root, "packages/app"), {
  PASEO_WEB_PLATFORM: "electron",
});
await run("npm", ["run", "build:main", "--workspace=@getpaseo/desktop"]);
await run(
  "npx",
  [
    "electron-builder",
    "--config",
    "electron-builder.codely.yml",
    "--mac",
    "--arm64",
    "--publish",
    "never",
  ],
  path.join(root, "packages/desktop"),
);
