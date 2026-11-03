# Install (hardened fork)

Instructions for a person or a coding agent. This fork runs from a clone; never install it with `npx`
(that fetches the upstream package instead).

## 1. Check Node

`node --version` must be 22.13 or newer.

## 2. Clone and build

```sh
git clone https://github.com/sterlingmoses/api-anything-hardened.git
cd api-anything-hardened
npm ci --ignore-scripts
npm run build
```

## 3. Run setup

```sh
node dist/cli.js setup --dry-run   # what it would change
node dist/cli.js setup
```

It adds an MCP server entry to Claude Code (`node <clone>/dist/cli.js mcp`) and installs the skill
in `~/.claude/skills/api-anything/`. It backs up each file before its first edit, leaves other MCP
entries alone, and asks nothing: sharing is always off. Restart Claude Code afterwards.

## 4. Check a call

```sh
node dist/cli.js call hacker-news search query=sqlite
```

Expect `"ok":true` and `"tier":1`, a plain HTTP call with no browser.

For another MCP client, run `node dist/cli.js mcp --print-config` and use the entry it prints.
