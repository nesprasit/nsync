import { test } from "node:test";
import assert from "node:assert/strict";
import { clientProblem, normalizeClient, parseClientJson } from "../src/auth/client";

const ID = "1234-abc.apps.googleusercontent.com";

test("clientProblem: missing values", () => {
  assert.match(clientProblem({}) ?? "", /Client ID and Client secret/);
  assert.match(clientProblem({ clientId: ID }) ?? "", /Client ID and Client secret/);
  assert.match(clientProblem({ clientSecret: "s" }) ?? "", /Client ID and Client secret/);
});

test("clientProblem: wrong Client ID shape", () => {
  assert.match(clientProblem({ clientId: "abc", clientSecret: "s" }) ?? "", /apps\.googleusercontent\.com/);
});

test("clientProblem: valid client, whitespace tolerated", () => {
  assert.equal(clientProblem({ clientId: `  ${ID} `, clientSecret: " s " }), null);
  assert.deepEqual(normalizeClient({ clientId: ` ${ID} `, clientSecret: " s " }), { clientId: ID, clientSecret: "s" });
});

test("parseClientJson: Google's downloaded web client file", () => {
  const json = JSON.stringify({ web: { client_id: ID, client_secret: "sec", redirect_uris: [] } });
  assert.deepEqual(parseClientJson(json), { clientId: ID, clientSecret: "sec" });
});

test("parseClientJson: installed-app shape and bare object", () => {
  assert.deepEqual(parseClientJson(JSON.stringify({ installed: { client_id: ID, client_secret: "x" } })), {
    clientId: ID,
    clientSecret: "x",
  });
  assert.deepEqual(parseClientJson(JSON.stringify({ client_id: ID, client_secret: "y" })), {
    clientId: ID,
    clientSecret: "y",
  });
});

test("parseClientJson: plain Client ID or junk returns null", () => {
  assert.equal(parseClientJson(ID), null);
  assert.equal(parseClientJson("{not json"), null);
  assert.equal(parseClientJson(JSON.stringify({ web: { client_id: ID } })), null);
});
