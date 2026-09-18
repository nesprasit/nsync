import { test } from "node:test";
import assert from "node:assert/strict";
import {
  namespaceHint,
  needsFirstSyncConfirm,
  summarizePlan,
  type FirstSyncInfo,
} from "../src/sync/firstSync";
import type { SyncAction } from "../src/sync/types";

const up = (path: string): SyncAction => ({ kind: "upload", path });
const noop = (path: string): SyncAction => ({ kind: "noop", path });

test("needsFirstSyncConfirm only for a never-synced vault with work to do", () => {
  assert.equal(needsFirstSyncConfirm(0, [up("a.md")]), true);
  assert.equal(needsFirstSyncConfirm(0, [noop("a.md")]), false); // nothing to do
  assert.equal(needsFirstSyncConfirm(0, []), false); // empty both sides
  assert.equal(needsFirstSyncConfirm(3, [up("a.md")]), false); // already synced before
});

test("summarizePlan buckets and sorts paths", () => {
  const s = summarizePlan([
    up("b.md"),
    up("a.md"),
    { kind: "download", path: "d.md", remoteFileId: "1" },
    { kind: "conflict", path: "c.md", remoteFileId: "2", base: false },
    { kind: "delete-local", path: "x.md" },
    noop("n.md"),
  ]);
  assert.deepEqual(s, {
    upload: ["a.md", "b.md"],
    download: ["d.md"],
    both: ["c.md"],
    deleteLocal: ["x.md"],
    deleteRemote: [],
  });
});

const info = (over: Partial<FirstSyncInfo>): FirstSyncInfo => ({
  namespace: "Gold2go",
  localCount: 10,
  remoteCount: 0,
  otherNamespaces: [],
  plan: summarizePlan([]),
  ...over,
});

test("namespaceHint flags an empty namespace next to other vaults", () => {
  const hint = namespaceHint(info({ otherNamespaces: ["Gold2Go", "Asia Plus"] }));
  assert.match(hint ?? "", /"Gold2Go", "Asia Plus"/);
  assert.match(hint ?? "", /Vault name on Google Drive/);
});

test("namespaceHint stays quiet when nothing looks off", () => {
  assert.equal(namespaceHint(info({ remoteCount: 5, otherNamespaces: ["Other"] })), null); // has its own files
  assert.equal(namespaceHint(info({ otherNamespaces: [] })), null); // first vault on this account
});
