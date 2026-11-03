// The local copy's guarantees: nothing goes to the shared registry, sharing is always off,
// the everyday browser's cookies are never read, and setup runs this checkout, never npx.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { loadSettings } from "../src/identity.js";
import { importFromBrowsers } from "../src/import.js";
import { RegistryError, registryRequest, search } from "../src/registry.js";
import { SERVER } from "../src/setup.js";

test("local copy: the registry is never fetched, sharing is off, browser cookies are never read", async () => {
  const realFetch = globalThis.fetch;
  let fetched = 0;
  globalThis.fetch = (() => {
    fetched++;
    throw new Error("fetch called");
  }) as typeof fetch;
  try {
    await assert.rejects(registryRequest("/v1/search?q=x"), RegistryError);
    const r = await search("weather", { local: [] });
    assert.deepEqual(r.matches, []);
    assert.match(r.registryError ?? "", /disabled/);
    assert.equal(fetched, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.deepEqual(loadSettings().share, false);
  assert.ok(loadSettings().askedAt, "counts as answered, so it is never asked");
  assert.equal(importFromBrowsers({ url: "https://example.com/" }), undefined);
  assert.equal(SERVER.command, "node");
  assert.ok(!SERVER.args.includes("-y"));
  assert.match(SERVER.args[0]!, /[/\\]cli\.(js|ts)$/);
  const skill = readFileSync(new URL("../skills/api-anything/SKILL.md", import.meta.url), "utf8");
  assert.ok(!/npx -y/.test(skill), "the skill never sends the agent to npx");
  assert.ok(!/\/Users\/|\/home\//.test(skill), "the skill names no one's home directory");
});
