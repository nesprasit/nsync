import { test } from "node:test";
import assert from "node:assert/strict";
import { formatBytes, summarizeRemote } from "../src/sync/remoteSummary";

test("groups files by vault namespace and strips the prefix", () => {
  const s = summarizeRemote([
    { name: "v/Gold2Go/notes/b.md", size: "200" },
    { name: "v/Gold2Go/a.md", size: "100" },
    { name: "v/Asia Plus/x.md", size: "50" },
  ]);
  assert.deepEqual(s.vaults.map((g) => g.ns), ["Asia Plus", "Gold2Go"]);
  const gold = s.vaults.find((g) => g.ns === "Gold2Go")!;
  assert.deepEqual(gold.files.map((f) => f.path), ["a.md", "notes/b.md"]); // sorted
  assert.equal(gold.bytes, 300);
  assert.equal(s.totalFiles, 3);
  assert.equal(s.totalBytes, 350);
});

test("separates metadata and legacy files", () => {
  const s = summarizeRemote([
    { name: "m/Gold2Go/tombstones.json", size: "10" },
    { name: "old-note.md", size: "5" },
    { name: "__nsync_tombstones__.json" },
  ]);
  assert.equal(s.vaults.length, 0);
  assert.deepEqual(s.meta.map((f) => f.path), ["m/Gold2Go/tombstones.json"]);
  assert.deepEqual(s.legacy.map((f) => f.path), ["__nsync_tombstones__.json", "old-note.md"]);
});

test("a malformed v/ name is shown as legacy, not dropped", () => {
  const s = summarizeRemote([{ name: "v/noslash" }]);
  assert.equal(s.vaults.length, 0);
  assert.equal(s.legacy.length, 1);
});

test("empty listing", () => {
  const s = summarizeRemote([]);
  assert.equal(s.totalFiles, 0);
  assert.equal(s.totalBytes, 0);
});

test("formatBytes", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(1023), "1023 B");
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(3 * 1024 * 1024), "3.0 MB");
  assert.equal(formatBytes(250 * 1024 * 1024), "250 MB");
});
