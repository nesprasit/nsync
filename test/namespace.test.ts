import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LEGACY_TOMBSTONE_FILE,
  isLegacyName,
  isValidNamespace,
  pathFromRemote,
  remoteName,
  tombstoneName,
} from "../src/sync/namespace";
import { massDeleteReason } from "../src/sync/reconcile";
import type { SyncAction } from "../src/sync/types";

test("remoteName / pathFromRemote round-trip", () => {
  const name = remoteName("Gold2Go", "notes/idea.md");
  assert.equal(name, "v/Gold2Go/notes/idea.md");
  assert.equal(pathFromRemote("Gold2Go", name), "notes/idea.md");
});

test("pathFromRemote ignores other vaults", () => {
  assert.equal(pathFromRemote("Gold2Go", remoteName("Asia Plus", "a.md")), null);
});

test("pathFromRemote does not match a vault whose name is a prefix of another", () => {
  // "Gold" must not claim files of "Gold2Go"
  assert.equal(pathFromRemote("Gold", remoteName("Gold2Go", "a.md")), null);
});

test("pathFromRemote ignores metadata and legacy files", () => {
  assert.equal(pathFromRemote("Gold2Go", tombstoneName("Gold2Go")), null);
  assert.equal(pathFromRemote("Gold2Go", "notes/idea.md"), null);
});

test("vault names with spaces work", () => {
  const name = remoteName("Top Charoen", "a b.md");
  assert.equal(pathFromRemote("Top Charoen", name), "a b.md");
});

test("legacy detection", () => {
  assert.equal(isLegacyName("notes/idea.md"), true);
  assert.equal(isLegacyName(LEGACY_TOMBSTONE_FILE), true);
  assert.equal(isLegacyName(remoteName("Gold2Go", "a.md")), false);
  assert.equal(isLegacyName(tombstoneName("Gold2Go")), false);
});

test("namespace validation", () => {
  assert.equal(isValidNamespace("Gold2Go"), true);
  assert.equal(isValidNamespace("Top Charoen"), true);
  assert.equal(isValidNamespace(""), false);
  assert.equal(isValidNamespace("   "), false);
  assert.equal(isValidNamespace("a/b"), false);
});

// --- mass-delete safety valve ---------------------------------------------

const del = (n: number): SyncAction[] =>
  Array.from({ length: n }, (_, i) => ({ kind: "delete-local", path: `f${i}.md` }));

test("massDeleteReason stops a pass that wipes most of the vault", () => {
  assert.match(massDeleteReason(del(80), 100) ?? "", /Safety stop/);
});

test("massDeleteReason allows normal deletes", () => {
  assert.equal(massDeleteReason(del(3), 100), null); // a few files
  assert.equal(massDeleteReason(del(4), 4), null); // tiny vault, under the floor of 5
  assert.equal(massDeleteReason(del(40), 100), null); // under half
});
