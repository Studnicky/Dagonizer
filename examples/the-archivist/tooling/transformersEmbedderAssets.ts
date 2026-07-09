/// <reference path="./virtual-transformers-embedder-assets.d.ts" />
/**
 * vite.ts: Vite plugin that lets `TransformersEmbedder` run fully offline in
 * a consuming Vite app — no CDN, no manual `public/` copying.
 *
 * `transformersEmbedderAssets()` serves (dev) or emits (build) two vendored
 * asset sets under a stable `@transformers-embedder/` URL prefix:
 *
 *   - `models/**`  — this package's vendored Hugging Face model files
 *     (`scripts/fetch-model.mjs` output, under `../models/` from this file).
 *   - `ort/**`      — onnxruntime-web's `.wasm`/`.mjs` runtime assets, resolved
 *     from the transitive `onnxruntime-web` dependency of `@huggingface/transformers`.
 *
 * A virtual module, `virtual:transformers-embedder-assets`, exports the two
 * resolved URL prefixes (`localModelPath`, `wasmPaths`) so a consumer wires
 * `new TransformersEmbedder({ localModelPath, wasmPaths })` without knowing
 * the prefix or Vite's configured `base` itself.
 *
 * All logic lives on the `TransformersEmbedderAssets` static class below,
 * including the plugin factory itself (`TransformersEmbedderAssets.plugin()`).
 * The exported `transformersEmbedderAssets` is a detached reference to that
 * static method — callable directly (`transformersEmbedderAssets(options)`)
 * as Vite's `vite.config.ts` convention expects, while the actual `noun.verb()`
 * factory stays a method on its domain class.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, posix, relative, resolve as resolvePath, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Plugin, ResolvedConfig, ViteDevServer } from 'vite';

/** Caller options for `transformersEmbedderAssets()`. Both fields are optional overrides for testing; the primary flow resolves both from this plugin module's own location. */
export type TransformersEmbedderAssetsOptionsType = {
  readonly modelsDir?: string;
  readonly ortDistDir?: string;
};

const VIRTUAL_MODULE_ID = 'virtual:transformers-embedder-assets';
const RESOLVED_VIRTUAL_MODULE_ID = `\0${VIRTUAL_MODULE_ID}`;
const URL_PREFIX = '@transformers-embedder/';
const MODELS_SEGMENT = 'models/';
const ORT_SEGMENT = 'ort/';

/** `Content-Type` by file extension for dev-server responses and emitted build assets. Extensions outside this map (or a missing file) 404 in dev. */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.mjs': 'text/javascript',
};

/** Static home for `transformersEmbedderAssets()`'s asset resolution, dev-serving, and build-emission logic. */
class TransformersEmbedderAssets {
  /**
   * Resolve the transformers embedder package's vendored `models/` dir, from
   * the caller override or by resolving the (bundler-agnostic) package itself.
   * The embedder package ships the weights under `models/` at its root; this
   * consumer-side plugin stages them into the app bundle.
   */
  static resolveModelsDir(options: TransformersEmbedderAssetsOptionsType): string {
    if (options.modelsDir !== undefined) return options.modelsDir;
    const mainUrl = import.meta.resolve('@studnicky/dagonizer-embedder-transformers');
    return join(dirname(fileURLToPath(mainUrl)), '..', 'models');
  }

  /**
   * Resolve onnxruntime-web's `dist/` dir, from the caller override, or via
   * `import.meta.resolve` against a stable exports subpath (works regardless
   * of hoisting), then a `node_modules/.pnpm/onnxruntime-web@*`
   * glob when `import.meta.resolve` cannot find it.
   */
  static resolveOrtDistDir(options: TransformersEmbedderAssetsOptionsType): string {
    if (options.ortDistDir !== undefined) {
      return options.ortDistDir;
    }
    return TransformersEmbedderAssets.#resolveOrtDistDirViaImportMeta() ?? TransformersEmbedderAssets.#resolveOrtDistDirViaPnpmGlob();
  }

  static #resolveOrtDistDirViaImportMeta(): string | undefined {
    try {
      const resolved = import.meta.resolve('onnxruntime-web/ort-wasm-simd-threaded.mjs');
      return dirname(fileURLToPath(resolved));
    } catch {
      return undefined;
    }
  }

  static #resolveOrtDistDirViaPnpmGlob(): string {
    const searchRoots = [process.cwd(), fileURLToPath(new URL('.', import.meta.url))];
    for (const root of searchRoots) {
      const found = TransformersEmbedderAssets.#findPnpmOrtDistDirFrom(root);
      if (found !== undefined) {
        return found;
      }
    }
    throw new Error(
      'transformersEmbedderAssets: could not resolve onnxruntime-web/dist via import.meta.resolve or a ' +
        'node_modules/.pnpm/onnxruntime-web@* glob. Ensure onnxruntime-web (a transitive dependency of ' +
        '@huggingface/transformers) is installed.',
    );
  }

  static #findPnpmOrtDistDirFrom(startDir: string): string | undefined {
    let dir = startDir;
    for (;;) {
      const pnpmDir = join(dir, 'node_modules', '.pnpm');
      if (existsSync(pnpmDir)) {
        const match = readdirSync(pnpmDir).find((entry) => entry.startsWith('onnxruntime-web@'));
        if (match !== undefined) {
          return join(pnpmDir, match, 'node_modules', 'onnxruntime-web', 'dist');
        }
      }
      const parent = dirname(dir);
      if (parent === dir) {
        return undefined;
      }
      dir = parent;
    }
  }

  /** `Content-Type` for `filePath`'s extension, or `undefined` for an unrecognised extension. */
  static contentTypeFor(filePath: string): string | undefined {
    return CONTENT_TYPES[extname(filePath)];
  }

  /**
   * Resolve `requestedRelativePath` against `baseDir` and verify the result
   * still lives under `baseDir` (no `..` escape). Returns the safe absolute
   * path, or `undefined` when the request escapes `baseDir`.
   */
  static resolveSafePath(baseDir: string, requestedRelativePath: string): string | undefined {
    const baseAbsolute = resolvePath(baseDir);
    const resolved = resolvePath(baseAbsolute, requestedRelativePath);
    return resolved === baseAbsolute || resolved.startsWith(`${baseAbsolute}${sep}`) ? resolved : undefined;
  }

  /** Recursively list every file under `dir`, as POSIX-separated paths relative to `dir` (stable emitted asset names on every OS). */
  static listFilesRelative(dir: string): readonly string[] {
    if (!existsSync(dir)) {
      return [];
    }
    const files: string[] = [];
    TransformersEmbedderAssets.#walk(dir, dir, files);
    return files;
  }

  static #walk(root: string, dir: string, files: string[]): void {
    for (const entry of readdirSync(dir, { 'withFileTypes': true })) {
      const entryPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        TransformersEmbedderAssets.#walk(root, entryPath, files);
      } else if (entry.isFile()) {
        files.push(relative(root, entryPath).split(sep).join(posix.sep));
      }
    }
  }

  /**
   * Emit every file under `dir` as a Rollup build asset at `{URL_PREFIX}{segment}{relativePath}`.
   * When `dir` is missing or empty, fails the build with `missingDirMessage` — offline model
   * assets are required input, not an optional extra to silently skip.
   */
  static emitAssetSet(context: { emitFile(asset: { type: 'asset'; fileName: string; source: Buffer }): string }, dir: string, segment: string, missingDirMessage: string | undefined): void {
    const files = TransformersEmbedderAssets.listFilesRelative(dir);
    if (files.length === 0 && missingDirMessage !== undefined) {
      throw new Error(missingDirMessage);
    }
    for (const relativePath of files) {
      context.emitFile({
        'type': 'asset',
        'fileName': `${URL_PREFIX}${segment}${relativePath}`,
        'source': readFileSync(join(dir, relativePath)),
      });
    }
  }

  /**
   * Build the `Plugin` object: serves (dev) or emits (build) `TransformersEmbedder`'s
   * vendored model + onnxruntime-web assets under `{base}@transformers-embedder/`,
   * and exposes their resolved URL prefixes via the `virtual:transformers-embedder-assets`
   * virtual module. Every reference inside is fully-qualified (`TransformersEmbedderAssets.…`,
   * never `this.…`), so the exported `transformersEmbedderAssets` const below can safely
   * be a detached reference to this method.
   */
  static plugin(options: TransformersEmbedderAssetsOptionsType = {}): Plugin {
    const modelsDir = TransformersEmbedderAssets.resolveModelsDir(options);
    const ortDistDirRef: { current: string } = { 'current': '' };
    let base = '/';

    return {
      'name': 'transformers-embedder-assets',

      configResolved(config: ResolvedConfig) {
        base = config.base;
        ortDistDirRef.current = TransformersEmbedderAssets.resolveOrtDistDir(options);
      },

      resolveId(id: string) {
        return id === VIRTUAL_MODULE_ID ? RESOLVED_VIRTUAL_MODULE_ID : undefined;
      },

      load(id: string) {
        if (id !== RESOLVED_VIRTUAL_MODULE_ID) {
          return undefined;
        }
        const localModelPath = `${base}${URL_PREFIX}${MODELS_SEGMENT}`;
        const wasmPaths = `${base}${URL_PREFIX}${ORT_SEGMENT}`;
        return `export const localModelPath = ${JSON.stringify(localModelPath)};\nexport const wasmPaths = ${JSON.stringify(wasmPaths)};\n`;
      },

      configureServer(server: ViteDevServer) {
        TransformersEmbedderAssets.configureServer(server, base, modelsDir, ortDistDirRef);
      },

      generateBundle() {
        TransformersEmbedderAssets.emitAssetSet(
          this,
          modelsDir,
          MODELS_SEGMENT,
          'transformersEmbedderAssets: no vendored model files found under ' +
            `${modelsDir}. Run "npm run fetch-model" in packages/dagonizer-embedder-transformers before building.`,
        );
        TransformersEmbedderAssets.emitAssetSet(this, ortDistDirRef.current, ORT_SEGMENT, undefined);
      },
    };
  }

  /** Dev-server middleware: serve `models/**` and `ort/**` under `{base}@transformers-embedder/`. */
  static configureServer(server: ViteDevServer, base: string, modelsDir: string, ortDistDirRef: { current: string }): void {
    const prefix = `${base}${URL_PREFIX}`;
    server.middlewares.use((req, res, next) => {
      const url = req.url ?? '';
      if (!url.startsWith(prefix)) {
        next();
        return;
      }
      const afterPrefix = decodeURIComponent(url.slice(prefix.length));
      const [assetDir, requestedRelativePath] = afterPrefix.startsWith(MODELS_SEGMENT)
        ? [modelsDir, afterPrefix.slice(MODELS_SEGMENT.length)]
        : afterPrefix.startsWith(ORT_SEGMENT)
          ? [ortDistDirRef.current, afterPrefix.slice(ORT_SEGMENT.length)]
          : [undefined, undefined];
      if (assetDir === undefined || requestedRelativePath === undefined) {
        next();
        return;
      }
      const safePath = TransformersEmbedderAssets.resolveSafePath(assetDir, requestedRelativePath);
      const contentType = safePath === undefined ? undefined : TransformersEmbedderAssets.contentTypeFor(safePath);
      if (safePath === undefined || contentType === undefined || !existsSync(safePath)) {
        res.statusCode = 404;
        res.end();
        return;
      }
      res.setHeader('Content-Type', contentType);
      res.end(readFileSync(safePath));
    });
  }
}

/**
 * Vite plugin factory. A detached reference to `TransformersEmbedderAssets.plugin`
 * (a `MemberExpression`, not a function/arrow literal) — the codebase's
 * `noun.verb()` static-factory convention, kept callable as a plain function
 * because Vite's ecosystem convention expects `import { thisPlugin } from '…'`
 * to be invoked directly (`transformersEmbedderAssets(options)`), not
 * `SomeClass.plugin(options)`, at the consumer's `vite.config.ts` call site.
 */
export const transformersEmbedderAssets = TransformersEmbedderAssets.plugin;
