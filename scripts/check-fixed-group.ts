/**
 * check-fixed-group: CI guard for Changesets `fixed`-group drift.
 *
 * Validates that every publishable package under `packages/` is listed in
 * `fixed[0]` of `.changeset/config.json`, and that every entry in `fixed[0]`
 * corresponds to a real workspace package (packages/, examples/, examples/*).
 *
 * Two violation classes:
 *   MISSING — publishable `packages/*` package not in the fixed group.
 *   STALE   — fixed-group entry with no matching workspace package anywhere.
 *
 * Run: tsx scripts/check-fixed-group.ts  (npm: pnpm run check:fixed-group)
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

// ── Workspace glob resolution ──────────────────────────────────────────────
// pnpm-workspace.yaml lists: packages/*, examples, examples/the-archivist,
// examples/the-cartographer.  We resolve each glob manually; no yaml parser
// needed — the only glob form used is `<dir>/*`.

class WorkspaceResolver {
  static roots(workspaceYaml: string): ReadonlyArray<string> {
    // Extract lines under `packages:` that are quoted directory entries.
    const lines = workspaceYaml.split('\n');
    const roots: string[] = [];
    let inPackages = false;
    for (const line of lines) {
      if (/^packages:/.test(line)) { inPackages = true; continue; }
      if (inPackages) {
        if (/^\s*-/.test(line)) {
          const raw = line.replace(/^\s*-\s*["']?/, '').replace(/["']?\s*$/, '').trim();
          roots.push(raw);
        } else if (/^\S/.test(line)) {
          inPackages = false;
        }
      }
    }
    return roots;
  }

  /** Expand each workspace root to the real directories it covers. */
  static dirs(repoRoot: string, roots: ReadonlyArray<string>): ReadonlyArray<string> {
    const dirs: string[] = [];
    for (const root of roots) {
      if (root.endsWith('/*')) {
        const parent = join(repoRoot, root.slice(0, -2));
        if (!existsSync(parent)) continue;
        for (const entry of readdirSync(parent, { withFileTypes: true })) {
          if (entry.isDirectory() && !entry.name.startsWith('.')) dirs.push(join(parent, entry.name));
        }
      } else {
        const dir = join(repoRoot, root);
        if (existsSync(dir)) dirs.push(dir);
      }
    }
    return dirs;
  }
}

// ── JSON field extraction (no `as` casts) ────────────────────────────────

class JsonReader {
  /** Read and parse a JSON file; return null if absent. */
  static read(path: string): unknown {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf8'));
  }

  /** Narrow an unknown value to an indexable record (cast-free guard). */
  static isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }

  /** Extract a string field from an unknown JSON object; return null if absent or wrong type. */
  static stringField(value: unknown, key: string): string | null {
    if (!JsonReader.isRecord(value)) return null;
    const field = value[key];
    return typeof field === 'string' ? field : null;
  }

  /** Extract a boolean field; return null if absent or wrong type. */
  static boolField(value: unknown, key: string): boolean | null {
    if (!JsonReader.isRecord(value)) return null;
    const field = value[key];
    return typeof field === 'boolean' ? field : null;
  }

  /** Extract an array field; return null if absent or wrong type. */
  static arrayField(value: unknown, key: string): ReadonlyArray<unknown> | null {
    if (!JsonReader.isRecord(value)) return null;
    const field = value[key];
    return Array.isArray(field) ? field : null;
  }

  /** Coerce an unknown array to string[], dropping non-string entries. */
  static toStringArray(arr: ReadonlyArray<unknown>): ReadonlyArray<string> {
    return arr.filter((x): x is string => typeof x === 'string');
  }
}

// ── Core guard logic ──────────────────────────────────────────────────────

class FixedGroupGuard {
  /** Run the full two-way consistency check. Returns null on success, a report string on failure. */
  static check(): string | null {
    // 1. Read .changeset/config.json
    const configPath = join(repoRoot, '.changeset', 'config.json');
    const config = JsonReader.read(configPath);

    const fixedOuter = JsonReader.arrayField(config, 'fixed');
    const fixedInner = fixedOuter !== null && fixedOuter.length > 0 ? fixedOuter[0] : undefined;
    const fixedRaw   = Array.isArray(fixedInner) ? JsonReader.toStringArray(fixedInner) : [];

    const ignoreRaw  = JsonReader.arrayField(config, 'ignore') ?? [];
    const ignoreSet  = new Set(JsonReader.toStringArray(ignoreRaw));
    const fixedSet   = new Set(fixedRaw);

    // 2. Enumerate packages/* publishable names
    const packagesDir = join(repoRoot, 'packages');
    const publishableNames: string[] = [];
    for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const pkgJson = JsonReader.read(join(packagesDir, entry.name, 'package.json'));
      const name    = JsonReader.stringField(pkgJson, 'name');
      const priv    = JsonReader.boolField(pkgJson, 'private');
      if (name !== null && priv !== true && !ignoreSet.has(name)) {
        publishableNames.push(name);
      }
    }

    // 3. Enumerate ALL workspace package names (for stale-entry check)
    const workspaceYaml = readFileSync(join(repoRoot, 'pnpm-workspace.yaml'), 'utf8');
    const wsRoots = WorkspaceResolver.roots(workspaceYaml);
    const wsDirs  = WorkspaceResolver.dirs(repoRoot, wsRoots);
    const allWorkspaceNames = new Set<string>();
    for (const dir of wsDirs) {
      const pkgJson = JsonReader.read(join(dir, 'package.json'));
      const name    = JsonReader.stringField(pkgJson, 'name');
      if (name !== null) allWorkspaceNames.add(name);
    }

    // 4. Two-way check
    const missing = publishableNames.filter(n => !fixedSet.has(n));
    const stale   = fixedRaw.filter(n => !allWorkspaceNames.has(n));

    if (missing.length === 0 && stale.length === 0) return null;

    const lines: string[] = ['check-fixed-group: fixed-group drift detected.\n'];

    if (missing.length > 0) {
      lines.push(`MISSING — publishable packages not in fixed[0] (add these to .changeset/config.json):`);
      for (const n of missing) lines.push(`  + "${n}"`);
      lines.push('');
    }

    if (stale.length > 0) {
      lines.push(`STALE — fixed[0] entries with no matching workspace package (remove from .changeset/config.json):`);
      for (const n of stale) lines.push(`  - "${n}"`);
      lines.push('');
    }

    lines.push(`Remediation: edit .changeset/config.json → fixed[0] to reflect the changes above.`);
    return lines.join('\n');
  }
}

// ── Driver ────────────────────────────────────────────────────────────────

const report = FixedGroupGuard.check();
if (report !== null) {
  process.stdout.write(report + '\n');
  process.exit(1);
}

// Count publishable packages for the success message
const packagesDir = join(repoRoot, 'packages');
const configJson  = JsonReader.read(join(repoRoot, '.changeset', 'config.json'));
const ignoreRawFinal = JsonReader.arrayField(configJson, 'ignore') ?? [];
const ignoreSetFinal = new Set(JsonReader.toStringArray(ignoreRawFinal));
let count = 0;
for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
  const pkgJson = JsonReader.read(join(packagesDir, entry.name, 'package.json'));
  const name    = JsonReader.stringField(pkgJson, 'name');
  const priv    = JsonReader.boolField(pkgJson, 'private');
  if (name !== null && priv !== true && !ignoreSetFinal.has(name)) count++;
}

process.stdout.write(`check-fixed-group: all ${count} publishable packages are in the fixed lockstep group.\n`);
