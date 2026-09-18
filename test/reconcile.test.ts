import { test } from "node:test";
import assert from "node:assert/strict";
import { planSync } from "../src/sync/reconcile";
import type { FileState, IndexEntry, SyncIndex, Tombstone } from "../src/sync/types";

// --- builders -------------------------------------------------------------

function base(path: string, hash: string, rev: string): IndexEntry {
  return { path, hash, mtime: 1000, remoteFileId: `id-${path}`, lastSyncRev: rev };
}
function index(...entries: IndexEntry[]): SyncIndex {
  return Object.fromEntries(entries.map((e) => [e.path, e]));
}
function localFile(path: string, hash: string, mtime = 2000): FileState {
  return { path, exists: true, hash, mtime };
}
function remoteFile(path: string, rev: string, size?: number): FileState {
  return { path, exists: true, remoteFileId: `id-${path}`, rev, size };
}
function map(...files: FileState[]): Map<string, FileState> {
  return new Map(files.map((f) => [f.path, f]));
}
const noTombstones = () => undefined;

/** Convenience: run planSync for a single path and return its one action. */
function plan(
  idx: SyncIndex,
  local: Map<string, FileState>,
  remote: Map<string, FileState>,
  getTombstone: (p: string) => Tombstone | undefined = noTombstones,
) {
  return planSync(idx, local, remote, getTombstone);
}

// --- no base (first sight) ------------------------------------------------

test("new local file -> upload", () => {
  const a = plan(index(), map(localFile("a.md", "h1")), map());
  assert.deepEqual(a, [{ kind: "upload", path: "a.md" }]);
});

test("new remote file -> download", () => {
  const a = plan(index(), map(), map(remoteFile("a.md", "r1", 10)));
  assert.deepEqual(a, [
    { kind: "download", path: "a.md", remoteFileId: "id-a.md", rev: "r1", size: 10 },
  ]);
});

test("no base, both sides exist -> conflict (base:false)", () => {
  const a = plan(index(), map(localFile("a.md", "h1")), map(remoteFile("a.md", "r1")));
  assert.equal(a.length, 1);
  assert.equal(a[0].kind, "conflict");
  assert.equal((a[0] as { base: boolean }).base, false);
});

test("new local but a newer tombstone exists -> delete-local (no resurrection)", () => {
  const tomb = (p: string): Tombstone | undefined =>
    p === "a.md" ? { path: p, deletedAt: 5000, deletedBy: "dev" } : undefined;
  const a = plan(index(), map(localFile("a.md", "h1", 2000)), map(), tomb);
  assert.deepEqual(a, [{ kind: "delete-local", path: "a.md" }]);
});

test("new local, tombstone older than the file -> upload (real re-creation)", () => {
  const tomb = (p: string): Tombstone | undefined =>
    p === "a.md" ? { path: p, deletedAt: 500, deletedBy: "dev" } : undefined;
  const a = plan(index(), map(localFile("a.md", "h1", 2000)), map(), tomb);
  assert.deepEqual(a, [{ kind: "upload", path: "a.md" }]);
});

// --- base exists ----------------------------------------------------------

test("nothing changed -> noop", () => {
  const idx = index(base("a.md", "h1", "r1"));
  const a = plan(idx, map(localFile("a.md", "h1")), map(remoteFile("a.md", "r1")));
  assert.deepEqual(a, [{ kind: "noop", path: "a.md" }]);
});

test("only local changed -> upload with existing remoteFileId", () => {
  const idx = index(base("a.md", "h1", "r1"));
  const a = plan(idx, map(localFile("a.md", "h2")), map(remoteFile("a.md", "r1")));
  assert.deepEqual(a, [{ kind: "upload", path: "a.md", remoteFileId: "id-a.md" }]);
});

test("only remote changed -> download", () => {
  const idx = index(base("a.md", "h1", "r1"));
  const a = plan(idx, map(localFile("a.md", "h1")), map(remoteFile("a.md", "r2")));
  assert.equal(a[0].kind, "download");
});

test("both changed -> conflict (base:true, remote wins canonical)", () => {
  const idx = index(base("a.md", "h1", "r1"));
  const a = plan(idx, map(localFile("a.md", "h2")), map(remoteFile("a.md", "r2")));
  assert.equal(a[0].kind, "conflict");
  assert.equal((a[0] as { base: boolean }).base, true);
});

test("local deleted, remote unchanged -> delete-remote", () => {
  const idx = index(base("a.md", "h1", "r1"));
  const a = plan(idx, map(), map(remoteFile("a.md", "r1")));
  assert.deepEqual(a, [{ kind: "delete-remote", path: "a.md", remoteFileId: "id-a.md" }]);
});

test("remote deleted, local unchanged -> delete-local", () => {
  const idx = index(base("a.md", "h1", "r1"));
  const a = plan(idx, map(localFile("a.md", "h1")), map());
  assert.deepEqual(a, [{ kind: "delete-local", path: "a.md" }]);
});

test("local changed, remote deleted -> upload (re-create, never lose the edit)", () => {
  const idx = index(base("a.md", "h1", "r1"));
  const a = plan(idx, map(localFile("a.md", "h2")), map());
  assert.deepEqual(a, [{ kind: "upload", path: "a.md" }]);
});

test("local deleted, remote changed -> download (resurrect remote edit)", () => {
  const idx = index(base("a.md", "h1", "r1"));
  const a = plan(idx, map(), map(remoteFile("a.md", "r2")));
  assert.equal(a[0].kind, "download");
});

test("deleted both sides -> forget stale index", () => {
  const idx = index(base("a.md", "h1", "r1"));
  const a = plan(idx, map(), map());
  assert.deepEqual(a, [{ kind: "forget", path: "a.md" }]);
});

// --- multi-file ordering-independent -------------------------------------

test("handles several paths in one pass", () => {
  const idx = index(base("keep.md", "h1", "r1"), base("gone.md", "h9", "r9"));
  const a = plan(
    idx,
    map(localFile("keep.md", "h1"), localFile("new.md", "hn")),
    map(remoteFile("keep.md", "r1")),
  );
  const byKind = Object.fromEntries(a.map((x) => [x.path, x.kind]));
  assert.equal(byKind["keep.md"], "noop");
  assert.equal(byKind["new.md"], "upload");
  assert.equal(byKind["gone.md"], "forget"); // in index but absent both sides -> drop stale entry
});
