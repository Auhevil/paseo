#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { mkdir, access, writeFile, chmod } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const directory =
  process.env.PASEO_CODELY_SIGNING_DIR ??
  path.join(os.homedir(), ".config/paseo-codely/android-signing");
const keystore = path.join(directory, "paseo-codely.p12");
const passwordFile = path.join(directory, "password");
async function exists(filename) {
  try {
    await access(filename);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
if ((await exists(keystore)) || (await exists(passwordFile))) {
  if (!(await exists(keystore)) || !(await exists(passwordFile)))
    throw new Error(
      "Incomplete signing directory. Restore its matching keystore/password; do not generate a replacement.",
    );
  console.log("Existing personal signing material retained.");
} else {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(passwordFile, randomBytes(36).toString("base64url") + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  const keytool = process.env.JAVA_HOME
    ? path.join(process.env.JAVA_HOME, "bin/keytool")
    : "keytool";
  const result = spawnSync(
    keytool,
    [
      "-genkeypair",
      "-keystore",
      keystore,
      "-storetype",
      "PKCS12",
      "-storepass:file",
      passwordFile,
      "-keypass:file",
      passwordFile,
      "-alias",
      "paseo-codely",
      "-keyalg",
      "RSA",
      "-keysize",
      "3072",
      "-validity",
      "10000",
      "-dname",
      "CN=Paseo Codely, OU=Personal, O=Auhevil",
    ],
    { stdio: "pipe" },
  );
  if (result.status !== 0)
    throw new Error(
      "Key generation failed. Inspect the external signing directory before retrying.",
    );
  await chmod(keystore, 0o600);
  console.log(
    "Created fixed personal Android signing material outside the repository. Back up that directory privately.",
  );
}
