import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { selectCodelyCli } from "./select-codely-cli.mjs";

function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), "paseo-cli-selector-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const bin = path.join(directory, "bin");
  mkdirSync(bin);
  const originalCliPath = path.join(directory, "original-cli");
  const targetPath = path.join(directory, "built-cli");
  const linkPath = path.join(bin, "paseo");
  const statePath = path.join(directory, "state", "selection.json");
  writeFileSync(originalCliPath, "original CLI", { mode: 0o755 });
  writeFileSync(targetPath, "built CLI", { mode: 0o755 });
  const originalTarget = path.relative(bin, originalCliPath);
  symlinkSync(originalTarget, linkPath);
  return { linkPath, targetPath, originalCliPath, statePath, originalTarget };
}

test("default preview leaves the original link and filesystem state untouched", (t) => {
  const files = fixture(t);
  const result = selectCodelyCli(files);
  assert.equal(result.status, "planned");
  assert.equal(result.mode, "dry-run");
  assert.equal(readlinkSync(files.linkPath), files.originalTarget);
  assert.equal(existsSync(path.dirname(files.statePath)), false);
  assert.equal(existsSync(`${files.linkPath}.codely-selector.lock`), false);
});

test("apply and rollback preserve exact targets and backup across repeated selections", (t) => {
  const files = fixture(t);
  assert.equal(selectCodelyCli({ ...files, apply: true }).status, "applied");
  assert.equal(readlinkSync(files.linkPath), files.targetPath);
  const saved = readFileSync(files.statePath, "utf8");
  assert.deepEqual(JSON.parse(saved), {
    version: 1,
    linkPath: files.linkPath,
    originalTarget: files.originalTarget,
    selectedTarget: files.targetPath,
  });
  assert.equal(lstatSync(files.statePath).mode & 0o777, 0o600);
  assert.equal(selectCodelyCli({ ...files, apply: true }).status, "unchanged");
  assert.equal(readFileSync(files.statePath, "utf8"), saved);
  assert.equal(selectCodelyCli({ ...files, rollback: true }).status, "planned");
  assert.equal(readlinkSync(files.linkPath), files.targetPath);
  assert.equal(selectCodelyCli({ ...files, rollback: true, apply: true }).status, "applied");
  assert.equal(readlinkSync(files.linkPath), files.originalTarget);
  assert.equal(selectCodelyCli({ ...files, rollback: true, apply: true }).status, "unchanged");
  assert.equal(selectCodelyCli({ ...files, apply: true }).status, "applied");
  assert.equal(readFileSync(files.statePath, "utf8"), saved);
  assert.equal(readFileSync(files.originalCliPath, "utf8"), "original CLI");
  assert.equal(readFileSync(files.targetPath, "utf8"), "built CLI");
  assert.deepEqual(readdirSync(path.dirname(files.linkPath)), ["paseo"]);
});

test("an unrelated initial symlink is preserved without creating a backup", (t) => {
  const files = fixture(t);
  unlinkSync(files.linkPath);
  symlinkSync("../user-cli", files.linkPath);
  assert.throws(() => selectCodelyCli({ ...files, apply: true }), /unknown selection/);
  assert.equal(readlinkSync(files.linkPath), "../user-cli");
  assert.equal(existsSync(files.statePath), false);
});

const replacements = [
  {
    name: "unrelated symlink",
    replace: (linkPath) => symlinkSync("../user-cli", linkPath),
    verify: (linkPath) => assert.equal(readlinkSync(linkPath), "../user-cli"),
  },
  {
    name: "regular file",
    replace: (linkPath) => writeFileSync(linkPath, "user-owned executable"),
    verify: (linkPath) => assert.equal(readFileSync(linkPath, "utf8"), "user-owned executable"),
  },
  {
    name: "directory",
    replace: (linkPath) => mkdirSync(linkPath),
    verify: (linkPath) => assert.equal(lstatSync(linkPath).isDirectory(), true),
  },
  {
    name: "removed link",
    replace: () => {},
    verify: (linkPath) => assert.throws(() => lstatSync(linkPath), { code: "ENOENT" }),
  },
];

for (const replacement of replacements) {
  test(`apply and rollback preserve a user replacement: ${replacement.name}`, (t) => {
    const files = fixture(t);
    selectCodelyCli({ ...files, apply: true });
    const saved = readFileSync(files.statePath, "utf8");
    unlinkSync(files.linkPath);
    replacement.replace(files.linkPath);
    const preserve = () => {
      replacement.verify(files.linkPath);
      assert.equal(readFileSync(files.statePath, "utf8"), saved);
      assert.equal(existsSync(`${files.linkPath}.codely-selector.lock`), false);
    };
    assert.throws(() => selectCodelyCli({ ...files, apply: true }));
    preserve();
    assert.throws(() => selectCodelyCli({ ...files, rollback: true, apply: true }));
    preserve();
  });
}

test("rollback without a backup leaves the existing link untouched", (t) => {
  const files = fixture(t);
  assert.throws(() => selectCodelyCli({ ...files, rollback: true, apply: true }), /No original/);
  assert.equal(readlinkSync(files.linkPath), files.originalTarget);
  assert.equal(existsSync(files.statePath), false);
});

const invalidBackups = [
  { name: "corrupt", change: (files) => writeFileSync(files.statePath, "not json") },
  {
    name: "different-candidate",
    change: (files) => {
      const record = JSON.parse(readFileSync(files.statePath, "utf8"));
      record.selectedTarget = `${files.targetPath}-other`;
      writeFileSync(files.statePath, JSON.stringify(record));
    },
  },
  {
    name: "symlink",
    change: (files) => {
      unlinkSync(files.statePath);
      symlinkSync(files.originalCliPath, files.statePath);
    },
  },
];

for (const backup of invalidBackups) {
  test(`a ${backup.name} backup is rejected without touching the selected CLI`, (t) => {
    const files = fixture(t);
    selectCodelyCli({ ...files, apply: true });
    backup.change(files);
    assert.throws(() => selectCodelyCli({ ...files, rollback: true, apply: true }));
    assert.equal(readlinkSync(files.linkPath), files.targetPath);
    assert.equal(readFileSync(files.originalCliPath, "utf8"), "original CLI");
  });
}

test("a missing or non-executable candidate is refused before writing the backup", (t) => {
  const files = fixture(t);
  chmodSync(files.targetPath, 0o644);
  assert.throws(() => selectCodelyCli({ ...files, apply: true }), { code: "EACCES" });
  unlinkSync(files.targetPath);
  assert.throws(() => selectCodelyCli({ ...files, apply: true }), { code: "ENOENT" });
  assert.equal(readlinkSync(files.linkPath), files.originalTarget);
  assert.equal(existsSync(files.statePath), false);
});

test("rollback remains available after the local build is removed", (t) => {
  const files = fixture(t);
  selectCodelyCli({ ...files, apply: true });
  unlinkSync(files.targetPath);
  assert.equal(selectCodelyCli({ ...files, rollback: true, apply: true }).status, "applied");
  assert.equal(readlinkSync(files.linkPath), files.originalTarget);
});

test("an existing lock is preserved and prevents an apply", (t) => {
  const files = fixture(t);
  const lockPath = `${files.linkPath}.codely-selector.lock`;
  mkdirSync(lockPath);
  writeFileSync(path.join(lockPath, "owner"), "other process");
  assert.throws(() => selectCodelyCli({ ...files, apply: true }), { code: "EEXIST" });
  assert.equal(readlinkSync(files.linkPath), files.originalTarget);
  assert.equal(readFileSync(path.join(lockPath, "owner"), "utf8"), "other process");
  assert.equal(existsSync(files.statePath), false);
});

test("backup failure releases our lock and leaves the original link untouched", (t) => {
  const files = fixture(t);
  const blockedParent = path.dirname(files.statePath);
  symlinkSync("missing-state-directory", blockedParent);
  assert.throws(() => selectCodelyCli({ ...files, apply: true }));
  assert.equal(readlinkSync(blockedParent), "missing-state-directory");
  assert.equal(readlinkSync(files.linkPath), files.originalTarget);
  assert.deepEqual(readdirSync(path.dirname(files.linkPath)), ["paseo"]);
});
