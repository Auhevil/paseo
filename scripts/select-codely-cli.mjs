#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import {
  accessSync,
  closeSync,
  constants,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmdirSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isMainModule } from "./is-main-module.mjs";

function symlinkSnapshot(linkPath) {
  const info = lstatSync(linkPath);
  if (!info.isSymbolicLink()) throw new Error(`Refusing to replace a non-symlink: ${linkPath}`);
  return { target: readlinkSync(linkPath), dev: info.dev, ino: info.ino };
}

function readBackup(options) {
  let info;
  try {
    info = lstatSync(options.statePath);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  if (!info.isFile()) throw new Error("The CLI selection backup must be a regular file.");
  const backup = JSON.parse(readFileSync(options.statePath, "utf8"));
  const belongsToSelection =
    backup?.version === 1 &&
    backup.linkPath === options.linkPath &&
    backup.selectedTarget === options.targetPath &&
    typeof backup.originalTarget === "string";
  if (!belongsToSelection)
    throw new Error("The CLI selection backup belongs to another selection.");
  const originalPath = path.resolve(path.dirname(options.linkPath), backup.originalTarget);
  if (originalPath !== options.originalCliPath) {
    throw new Error("The saved original CLI does not match --previous.");
  }
  return backup;
}

function inspectSelection(options) {
  const current = symlinkSnapshot(options.linkPath);
  const backup = readBackup(options);
  if (options.rollback && !backup) throw new Error("No original CLI selection backup exists.");
  if (!statSync(options.originalCliPath).isFile()) {
    throw new Error("The preserved original CLI is unavailable.");
  }
  accessSync(options.originalCliPath, constants.R_OK | constants.X_OK);
  if (!options.rollback && !statSync(options.targetPath).isFile()) {
    throw new Error("The built CLI is unavailable.");
  }
  if (!options.rollback) accessSync(options.targetPath, constants.R_OK | constants.X_OK);
  const originalTarget = backup?.originalTarget ?? current.target;
  const originalPath = path.resolve(path.dirname(options.linkPath), originalTarget);
  if (originalPath !== options.originalCliPath) {
    throw new Error("Current CLI does not match --previous; refusing an unknown selection.");
  }
  const isOriginal = current.target === originalTarget;
  const isSelected = backup !== null && current.target === options.targetPath;
  if (!isOriginal && !isSelected) {
    throw new Error("CLI symlink changed outside this selector; leaving it untouched.");
  }
  const nextTarget = options.rollback ? originalTarget : options.targetPath;
  return { current, backup, originalTarget, nextTarget };
}

function saveBackup(options, selection) {
  if (selection.backup) return;
  mkdirSync(path.dirname(options.statePath), { recursive: true });
  const fd = openSync(options.statePath, "wx", 0o600);
  try {
    writeFileSync(
      fd,
      `${JSON.stringify(
        {
          version: 1,
          linkPath: options.linkPath,
          originalTarget: selection.originalTarget,
          selectedTarget: options.targetPath,
        },
        null,
        2,
      )}\n`,
    );
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function replaceSymlink(linkPath, selection) {
  const temporaryLink = path.join(path.dirname(linkPath), `.paseo-codely-${randomUUID()}.tmp`);
  symlinkSync(selection.nextTarget, temporaryLink);
  let renamed = false;
  try {
    const current = symlinkSnapshot(linkPath);
    const unchanged =
      current.dev === selection.current.dev &&
      current.ino === selection.current.ino &&
      current.target === selection.current.target;
    if (!unchanged) throw new Error("CLI symlink changed during selection; leaving it untouched.");
    renameSync(temporaryLink, linkPath);
    renamed = true;
  } finally {
    if (!renamed) unlinkSync(temporaryLink);
  }
}

/** Atomically select one built CLI, retaining an exact rollback target. */
export function selectCodelyCli(options) {
  for (const name of ["linkPath", "targetPath", "originalCliPath", "statePath"]) {
    if (!path.isAbsolute(options[name])) throw new Error(`${name} must be an absolute path.`);
  }
  let selection = inspectSelection(options);
  let status = "planned";
  if (selection.current.target === selection.nextTarget) status = "unchanged";
  else if (options.apply) {
    const lockPath = `${options.linkPath}.codely-selector.lock`;
    mkdirSync(lockPath, { mode: 0o700 });
    try {
      selection = inspectSelection(options);
      if (selection.current.target === selection.nextTarget) status = "unchanged";
      else {
        saveBackup(options, selection);
        replaceSymlink(options.linkPath, selection);
        status = "applied";
      }
    } finally {
      rmdirSync(lockPath);
    }
  }
  return {
    action: options.rollback ? "rollback" : "select",
    mode: options.apply ? "apply" : "dry-run",
    status,
    linkPath: options.linkPath,
    previousTarget: selection.current.target,
    nextTarget: selection.nextTarget,
    backupPath: options.statePath,
  };
}

function main(args) {
  const values = {};
  const flags = new Set();
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (["--apply", "--dry-run", "--rollback", "--help"].includes(arg)) flags.add(arg);
    else if (["--link", "--previous", "--state", "--target"].includes(arg)) {
      const value = args[++index];
      if (!value || !path.isAbsolute(value)) throw new Error(`${arg} requires an absolute path.`);
      if (values[arg]) throw new Error(`Duplicate argument: ${arg}`);
      values[arg] = value;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (flags.has("--help")) {
    process.stdout.write(
      "Usage: select-codely-cli.mjs --link PATH --previous PATH --state PATH [--target PATH] [--apply | --dry-run] [--rollback]\nDefaults to dry-run. Never starts or stops a daemon.\n",
    );
    return;
  }
  if (flags.has("--apply") && flags.has("--dry-run"))
    throw new Error("Choose either --apply or --dry-run.");
  for (const key of ["--link", "--previous", "--state"])
    if (!values[key]) throw new Error(`Missing ${key}`);
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const rollback = args.includes("--rollback");
  if (!rollback) {
    for (const file of [
      "packages/cli/dist/index.js",
      "packages/server/dist/scripts/supervisor-entrypoint.js",
      "packages/server/dist/server/web-ui/index.html",
    ]) {
      if (!statSync(path.join(repo, file)).isFile())
        throw new Error(`Build artifact missing: ${file}`);
    }
  }
  const result = selectCodelyCli({
    linkPath: values["--link"],
    originalCliPath: values["--previous"],
    targetPath: values["--target"] ?? path.join(repo, "packages/cli/bin/paseo"),
    statePath: values["--state"],
    apply: args.includes("--apply"),
    rollback,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (isMainModule(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
