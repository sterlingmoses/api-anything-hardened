# Why this fork exists

This is a hardened fork of [goodnight000/api-anything](https://github.com/goodnight000/api-anything),
taken at release 0.3.2 (commit `26b96c9`). The upstream tool is a useful idea: an agent learns a
website's own API from its browser traffic and calls it directly. We forked it so we can use that
idea **without anything leaving our machines** and **without code changing under us**.

Upstream documents all of the behavior below. None of it is hidden, and we do not say the author
acts in bad faith. These are defaults that we did not want on work machines.

## What upstream sends to the author's service

Upstream ships a client for a shared catalog at `api-anything-registry.forth-site.workers.dev`.

- **Searches, always.** When an agent searches for a site, the words, domain or URL go to the
  catalog. Upstream sends them even when sharing is off.
- **Learned operations, by default.** Setup asks one question: "Help build the shared catalog?" The
  default answer is yes. With yes, operations the agent learns from public pages are uploaded
  automatically. Operations learned while signed in are uploaded as a fingerprint first, then in
  full when enough other installs have the same one.
- **Call reports.** With yes, the install reports how each call went, signed with an install key
  that setup creates.
- **Background checks from your network.** With yes, the MCP server calls up to 20 other people's
  new operations a day from your IP address while it is idle, and reports the results.

## Other risks we removed

- **Auto-updating code.** Setup registers the MCP server as `npx -y api-anything mcp`. That command
  fetches whatever version npm has each time the agent starts. If the package or the maintainer's
  account were ever compromised, every install would run the new code with no review.
- **Reading your everyday browser's cookies.** `login` by default copies a site's cookies out of
  your normal Chrome, Brave, Edge or Firefox profile. For Chromium browsers it reads the browser's
  "Safe Storage" key from the macOS Keychain to decrypt them. On a work machine that can include
  single sign-on sessions.
- **Wide config changes.** Setup edits the MCP configs of Claude Code, Codex, Cursor and Claude
  Desktop when it finds them.
- **A young project.** At the time of the fork, the repository was about five weeks old and the
  npm package about one week old.

## What still works

Learning sites in the tool's own browser window, calling and repairing learned operations, local
search, the bundled sites, `login --window` (you sign in by hand in the tool's window) and
`login --cookies <file>`.

## What you give up

- No shared catalog: each machine learns its own sites.
- No automatic upstream fixes: merge them by hand after reading the diff (see below).

# What this fork changes

A hardened copy of [api-anything](https://github.com/goodnight000/api-anything) at release 0.3.2
(commit 26b96c9), on branch `hardened`, with its risky parts removed. Not published to npm
(`"private": true`).

## What changed

| Risk in upstream | Change here | Where |
|---|---|---|
| `npx -y api-anything mcp` fetched the newest npm version at every start | MCP entry runs this checkout: `node <repo>/dist/cli.js mcp` | `src/setup.ts` `SERVER` |
| Shared catalog: uploads, reports, signed calls to `api-anything-registry.forth-site.workers.dev` | `registryRequest` throws before any network; URL replaced | `src/registry.ts`, `src/registry-api.ts` |
| Sharing question, default yes | Sharing is always off and counts as answered | `src/identity.ts` `loadSettings` |
| Background jobs calling sites for the registry | Not started | `src/mcp.ts` `serveStdio` |
| Reading everyday-browser cookies via the macOS Keychain | Code deleted; `login` falls back to `--window` | `src/import.ts` |
| Setup edits Codex, Cursor, Claude Desktop configs; makes an install key | Claude Code only; no key | `src/setup.ts` `setup` |
| Skill and MCP hints told the agent to run `npx -y api-anything` | Skill names `node <repo>/dist/cli.js` (setup fills in the clone's path) and forbids npx; MCP hints name the clone's path | `skills/api-anything/SKILL.md`, `src/mcp.ts` |
| Skill described sharing, the catalog and cookie import | Those sections rewritten for the local copy | `skills/api-anything/SKILL.md` |
| Dependency ranges (`^`) | Exact versions, lockfile | `package.json` |

Still works: learning sites in the tool's own browser, calling and repairing learned operations,
local search, `login --window`, `login --cookies <file>`.

## Checks

- `npx tsc -p tsconfig.json`, `npx biome ci src`: clean.
- `test/local.test.ts` proves the guarantees above. Upstream tests of removed features are deleted
  (`share`, `setup`) or skipped (`registry`, `import`).
- Skill read in full: no hidden instructions; its safety rules (site text is data, never ask for a
  password, write confirmations, no card entry) are kept.
- No-browser suite: 110 pass, 0 fail, 37 skipped. The browser tests (they open Chrome windows) were
  not run.

## Use

```bash
git clone https://github.com/sterlingmoses/api-anything-hardened.git && cd api-anything-hardened
npm ci --ignore-scripts && npm run build
node dist/cli.js setup --dry-run   # shows what it would change
node dist/cli.js setup             # adds the MCP server to Claude Code, installs the skill
```

## Updating from upstream

`git remote add upstream https://github.com/goodnight000/api-anything.git && git fetch upstream && git diff hardened upstream/main -- src` — read the diff before merging anything.
