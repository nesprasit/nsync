import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyResult, progressText, summaryText, tally } from "../src/sync/progress";

test("progressText per phase", () => {
  assert.equal(progressText({ phase: "listing", done: 0, total: 0 }), "checking Google Drive…");
  assert.equal(progressText({ phase: "scanning", done: 40, total: 120 }), "scanning 40/120");
  assert.equal(
    progressText({ phase: "applying", done: 3, total: 12, action: "upload", path: "notes/a.md" }),
    "uploading 3/12",
  );
});

test("progressText adds the file path only when asked", () => {
  const p = { phase: "applying" as const, done: 1, total: 2, action: "download" as const, path: "x/y.md" };
  assert.equal(progressText(p, true), "downloading 1/2\nx/y.md");
});

test("tally + summaryText", () => {
  const r = emptyResult();
  for (const k of ["upload", "upload", "upload", "download", "download", "delete-local", "delete-remote", "conflict", "forget"] as const) {
    tally(r, k);
  }
  assert.deepEqual(r, { uploaded: 3, downloaded: 2, deletedLocal: 1, deletedRemote: 1, conflicts: 1 });
  assert.equal(summaryText(r), "↑3 uploaded · ↓2 downloaded · 2 deleted · 1 conflict");
});

test("summaryText when nothing changed", () => {
  assert.equal(summaryText(emptyResult()), "up to date");
});

test("summaryText pluralises conflicts", () => {
  const r = emptyResult();
  r.conflicts = 2;
  assert.equal(summaryText(r), "2 conflicts");
});
