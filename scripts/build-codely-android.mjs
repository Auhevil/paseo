#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";

const root = fileURLToPath(new URL("../", import.meta.url));
const signingDirectory =
  process.env.PASEO_CODELY_SIGNING_DIR ??
  path.join(os.homedir(), ".config/paseo-codely/android-signing");
if (!process.env.JAVA_HOME || !process.env.ANDROID_HOME)
  throw new Error("Set JAVA_HOME and ANDROID_HOME before building Android.");
const password = (await readFile(path.join(signingDirectory, "password"), "utf8")).trim();
if (!password) throw new Error("The external Android signing password is empty.");
const env = {
  ...process.env,
  CI: "1",
  APP_VARIANT: "codely",
  PASEO_ANDROID_KEYSTORE: path.join(signingDirectory, "paseo-codely.p12"),
  PASEO_ANDROID_STORE_PASSWORD: password,
  PASEO_ANDROID_KEY_PASSWORD: password,
  PASEO_ANDROID_KEY_ALIAS: "paseo-codely",
};
function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: "inherit", shell: false });
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
await run("npm", ["run", "build:client"], root);
await run(
  "npx",
  ["expo", "prebuild", "--platform", "android", "--no-install"],
  path.join(root, "packages/app"),
);
await run(
  "./gradlew",
  [
    "assembleRelease",
    "-x",
    "lint",
    "-x",
    "lintVitalAnalyzeRelease",
    "-x",
    "lintVitalRelease",
    "-x",
    "generateReleaseLintModel",
    "-x",
    "generateReleaseLintVitalModel",
    "--no-daemon",
    "--max-workers=2",
    "-Dorg.gradle.parallel=false",
    "-Dorg.gradle.internal.http.connectionTimeout=30000",
    "-Dorg.gradle.internal.http.socketTimeout=30000",
  ],
  path.join(root, "packages/app/android"),
);
