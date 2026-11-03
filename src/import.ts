/**
 * Local copy: reading cookies from the user's everyday browser (and the macOS Keychain key that
 * decrypts them) is removed. What is left lists browser profiles and parses a cookie file the user
 * passes with `login --cookies`.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { siteOf } from "./session.js";
import type { StoredCookie } from "./types.js";

/** One installed browser to scan. Tests inject these via API_ANYTHING_BROWSER_ROOTS. */
export interface BrowserRoot {
  /** display name, also the Keychain service prefix: "<name> Safe Storage" */
  name: string;
  family: "chromium" | "firefox";
  /** user-data dir (chromium) or profiles dir (firefox) */
  root: string;
  /** overrides the OS key lookup (test injection; also Linux "peanuts") */
  password?: string;
  /** PBKDF2 iterations (chromium): macOS 1003, Linux v10 1 */
  iterations?: number;
}

export interface ImportedSession {
  cookies: StoredCookie[];
  /** "<browser-lower>:<profile>", e.g. "chrome:Profile 1"; recorded so a heal re-imports the same one */
  source: string;
  browser: string;
  profile: string;
  /** the profile's display name and Google account, from Chrome's Local State, so a human can tell whose it is */
  name?: string;
  email?: string;
}

/** One browser profile a human can pick with --profile. */
export interface ProfileChoice {
  /** the --profile value: "Chrome/Profile 1" */
  profile: string;
  name?: string;
  email?: string;
}

/** Several profiles hold the site's login: importing one would be a guess between accounts. */
export class AmbiguousProfile extends Error {
  constructor(
    readonly site: string,
    readonly candidates: ProfileChoice[],
  ) {
    super(
      `${candidates.length} browser profiles are signed in to ${site}; pick one: ${candidates.map((c) => `"${c.profile}"${c.name || c.email ? ` (${[c.name, c.email].filter(Boolean).join(", ")})` : ""}`).join(", ")}`,
    );
    this.name = "AmbiguousProfile";
  }
}

const CHROMIUM_MAC: [string, string][] = [
  ["Chrome", "Google/Chrome"],
  ["Chrome Beta", "Google/Chrome Beta"],
  ["Brave", "BraveSoftware/Brave-Browser"],
  ["Edge", "Microsoft Edge"],
  ["Arc", "Arc/User Data"],
  ["Chromium", "Chromium"],
  ["Vivaldi", "Vivaldi"],
];

/** Installed browsers on this OS, or the injected set for tests. */
export function browserRoots(): BrowserRoot[] {
  const injected = process.env.API_ANYTHING_BROWSER_ROOTS;
  if (injected) return JSON.parse(injected) as BrowserRoot[];
  const out: BrowserRoot[] = [];
  const home = process.env.HOME || "";
  if (process.platform === "darwin") {
    const support = join(home, "Library", "Application Support");
    for (const [name, rel] of CHROMIUM_MAC) {
      const root = join(support, rel);
      if (existsSync(root)) out.push({ name, family: "chromium", root });
    }
    const ff = join(support, "Firefox", "Profiles");
    if (existsSync(ff)) out.push({ name: "Firefox", family: "firefox", root: ff });
  } else if (process.platform === "linux") {
    const config = process.env.XDG_CONFIG_HOME || join(home, ".config");
    for (const [name, rel] of [
      ["Chrome", "google-chrome"],
      ["Chromium", "chromium"],
      ["Brave", "BraveSoftware/Brave-Browser"],
      ["Edge", "microsoft-edge"],
    ] as const) {
      const root = join(config, rel);
      // Linux v10 is AES under a fixed password; v11 (secret-tool) is not attempted here.
      if (existsSync(root)) out.push({ name, family: "chromium", root, password: "peanuts", iterations: 1 });
    }
    const ff = join(home, ".mozilla", "firefox");
    if (existsSync(ff)) out.push({ name: "Firefox", family: "firefox", root: ff });
  }
  // Windows chromium uses app-bound encryption (DPAPI + more): not supported; login falls back to --window.
  return out;
}

interface Candidate {
  browser: string;
  profile: string;
  family: "chromium" | "firefox";
  root: BrowserRoot;
  dbPath: string;
  /** cookie names present for the site (plaintext, no decryption) */
  names: Set<string>;
}

/** true when a cookie's host_key/host belongs to the site's registrable domain. */
export const belongs = (host: string, site: string) => {
  const h = host.replace(/^\./, "").toLowerCase();
  return h === site || h.endsWith(`.${site}`) || siteOf(h) === site;
};

export interface ImportPin {
  browser?: string;
  profile: string;
}

/** Parse `--profile "Chrome/Profile 1"` or a session source "chrome:Profile 1" into a pin. */
export function parsePin(text: string): ImportPin {
  const sep = text.includes("/") ? "/" : ":";
  const i = text.indexOf(sep);
  if (i === -1) return { profile: text };
  return { browser: text.slice(0, i), profile: text.slice(i + 1) };
}

/** A chromium profile's display name and signed-in Google account, from the browser's "Local State". */
function profileInfo(c: Pick<Candidate, "family" | "root" | "profile">): { name?: string; email?: string } {
  if (c.family !== "chromium") return {};
  try {
    const state = JSON.parse(readFileSync(join(c.root.root, "Local State"), "utf8")) as {
      profile?: { info_cache?: Record<string, { name?: string; user_name?: string }> };
    };
    const info = state.profile?.info_cache?.[c.profile];
    return { ...(info?.name ? { name: info.name } : {}), ...(info?.user_name ? { email: info.user_name } : {}) };
  } catch {
    return {};
  }
}

/**
 * A session source ("chrome:Profile 1") as a human knows it, `Chrome profile "Work" (me@example.com)`,
 * and as `--profile` takes it, "Chrome/Profile 1".
 */
export function profileLabel(source: string): { label: string; profile: string } {
  const pin = parsePin(source);
  let root: BrowserRoot | undefined;
  try {
    root = browserRoots().find((r) => r.name.toLowerCase() === pin.browser?.toLowerCase());
  } catch {
    // a malformed API_ANYTHING_BROWSER_ROOTS: the bare source still names the profile
  }
  const info = root ? profileInfo({ family: root.family, root, profile: pin.profile }) : {};
  const browser = root?.name ?? pin.browser ?? "the browser";
  return {
    label: `${browser} profile "${info.name ?? pin.profile}"${info.email ? ` (${info.email})` : ""}`,
    profile: `${browser}/${pin.profile}`,
  };
}

/**
 * Import the site's cookies from the everyday browser: the one profile that holds the site's
 * `loginCookies` (for an unknown site, auth-looking cookies no signed-out visitor is also given, else
 * any cookies for it), or the `pin`ned one. Never a guess: when several profiles qualify (two people's
 * accounts), it throws AmbiguousProfile with their display names and emails. Undefined when nothing
 * is importable (the caller falls back to the window flow).
 */
export function importFromBrowsers(o: {
  url: string;
  loginCookies?: string[];
  pin?: ImportPin;
  /** the names a signed-out visit is given (`Session.guestCookies`): a profile holding only these is not signed in */
  guest?: string[];
}): ImportedSession | undefined {
  // local copy: never read the everyday browser's cookies; callers fall back to the visible window
  void o;
  return undefined;
}

export function cookiesFromFile(text: string, url: string): StoredCookie[] {
  const trimmed = text.trim();
  const host = new URL(url).hostname;
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    const parsed = JSON.parse(trimmed);
    const arr = Array.isArray(parsed) ? parsed : (parsed.cookies ?? []);
    return (arr as Record<string, unknown>[]).map((c) => normalizeJson(c, host));
  }
  // Netscape columns: domain, includeSubdomains, path, secure, expiry, name, value.
  // A leading "#HttpOnly_" on the domain marks an http-only cookie (curl/yt-dlp convention).
  return trimmed
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l && (!l.startsWith("#") || l.startsWith("#HttpOnly_")))
    .map((l) => l.split("\t"))
    .filter((f) => f.length >= 7)
    .map((f) => ({
      name: f[5]!,
      value: f[6]!,
      domain: f[0]!.replace(/^#HttpOnly_/, ""),
      path: f[2] || "/",
      expires: Number(f[4]) || -1,
      httpOnly: f[0]!.startsWith("#HttpOnly_"),
      secure: f[3]?.toUpperCase() === "TRUE",
    }));
}

function normalizeJson(c: Record<string, unknown>, host: string): StoredCookie {
  const exp = (c.expires ?? c.expirationDate) as number | undefined;
  return {
    name: String(c.name),
    value: String(c.value),
    domain: String(c.domain ?? host),
    path: String(c.path ?? "/"),
    expires: typeof exp === "number" ? Math.floor(exp) : -1,
    httpOnly: !!c.httpOnly,
    secure: !!c.secure,
    sameSite: (c.sameSite as StoredCookie["sameSite"]) || undefined,
  };
}
