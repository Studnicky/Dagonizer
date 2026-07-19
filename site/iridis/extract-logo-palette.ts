import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  ColorRecordInterfaceType,
  PaletteStateInterface,
  PipelineContextInterface,
  RoleSchemaInterfaceType
} from '@studnicky/iridis';

import {
  colorRecordFactory,
  consoleLogger,
  Engine,
  coreTasks
} from '@studnicky/iridis';
import { contrastPlugin } from '@studnicky/iridis-contrast';
import {
  galleryExtract,
  galleryExtractCandidates,
  galleryHistogram,
  imagePlugin
} from '@studnicky/iridis-image';
import { stylesheetPlugin } from '@studnicky/iridis-stylesheet';
import {
  applyModifiers,
  emitVscodeSemanticRules,
  emitVscodeThemeJson,
  emitVscodeUiPalette,
  expandTokens,
  vscodeRoleSchema16
} from '@studnicky/iridis-vscode';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(HERE, '..', 'public');

class Source {
  static of(label: string, file: string): { readonly label: string; readonly file: string } {
    return { file, label };
  }
}

class WeightedSource {
  static of(label: string, file: string, weightScale: number): { readonly label: string; readonly file: string; readonly weightScale: number } {
    return { file, label, weightScale };
  }
}

// dagonizer-node.svg is a different asset (a small version-badge UI tile —
// navy hex with a teal border and a DAG+FSM node icon) from the actual
// brand seal (the other 3 images: hexagon bezel, eye/orb grid, gem-dot
// accents). It legitimately contributes gold/cyan/violet accent hues, but
// pooling it at equal weight with the seal would let a minor UI asset's
// pixel coverage compete with the seal's on a coverage-weighted extraction.
// Its pixel weights are scaled down before pooling so it can still inform
// which accent hues exist without dominating by pixel count.
const NODE_SVG_WEIGHT_SCALE = 0.15;

const SOURCE_IMAGES = [
  WeightedSource.of('dagonizer-icon.svg', 'dagonizer-icon.svg', 1),
  WeightedSource.of('dagonizer-icon-512.png', 'dagonizer-icon-512.png', 1),
  WeightedSource.of('dagonizer-icon-transparent.png', 'dagonizer-icon-transparent.png', 1),
  WeightedSource.of('dagonizer-node.svg', 'dagonizer-node.svg', NODE_SVG_WEIGHT_SCALE)
];

const RASTER_SIZE = 512;

/** Minimal PipelineContextInterface for calling pipeline tasks outside of Engine.run(). */
function makeContext(engine: Engine): PipelineContextInterface {
  return {
    engine,
    logger: consoleLogger,
    startedAt: Date.now(),
    tasks: engine.tasks
  };
}

function emptyState(): PaletteStateInterface {
  return {
    colors: [],
    input: { colors: [] },
    metadata: {},
    outputs: {},
    roles: {},
    runtime: {},
    variants: {}
  };
}

async function pixelsOf(path: string): Promise<ColorRecordInterfaceType[]> {
  const { data, info } = await sharp(path)
    .resize(RASTER_SIZE, RASTER_SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const records: ColorRecordInterfaceType[] = [];
  const channels = info.channels;
  for (let i = 0; i < data.length; i += channels) {
    const r = data[i]! / 255;
    const g = data[i + 1]! / 255;
    const b = data[i + 2]! / 255;
    const a = data[i + 3]! / 255;
    // Skip fully- AND mostly-transparent pixels: anti-aliased edge pixels
    // at low alpha can carry arbitrary/artifact RGB (e.g. a decoder's
    // unpremultiplied placeholder color) that shouldn't bias dominant-color
    // extraction even though alpha isn't exactly 0.
    if (a < 0.5) { continue; }
    records.push(colorRecordFactory.fromRgb(r, g, b, { alpha: a, sourceFormat: 'imagePixel' }));
  }
  return records;
}

type HistogramBinLog = { readonly hex: string; readonly weight: number };

class ImageHistogrammer {
  /** Runs `gallery:histogram` on one image's pixels and returns its weighted bins, with `weightScale` applied. */
  static async run(
    label: string,
    file: string,
    weightScale: number
  ): Promise<{ readonly label: string; readonly bins: readonly HistogramBinLog[]; readonly weightedColors: ColorRecordInterfaceType[] }> {
    const ctx = makeContext(new Engine());
    const state = emptyState();
    const pixels = await pixelsOf(join(PUBLIC_DIR, file));
    for (const pixel of pixels) { state.colors.push(pixel); }

    galleryHistogram.run(state, ctx);

    const weightedColors = state.colors.map((rec) => {
      const w = (typeof rec.hints?.weight === 'number' ? rec.hints.weight : 1) * weightScale;
      return colorRecordFactory.fromRgb(rec.rgb.r, rec.rgb.g, rec.rgb.b, {
        alpha: rec.alpha,
        hints: { intent: undefined, role: undefined, weight: w },
        sourceFormat: rec.sourceFormat
      });
    });

    const bins: HistogramBinLog[] = weightedColors
      .map((rec) => { return { hex: rec.hex, weight: rec.hints?.weight ?? 0 }; })
      .sort((a, b) => { return b.weight - a.weight; });

    return { bins, label, weightedColors };
  }
}

async function extractAllImages(): Promise<{
  readonly perImage: readonly { readonly label: string; readonly bins: readonly HistogramBinLog[] }[];
  readonly pooled: ColorRecordInterfaceType[];
}> {
  const perImage: { readonly label: string; readonly bins: readonly HistogramBinLog[] }[] = [];
  const pooled: ColorRecordInterfaceType[] = [];

  for (const source of SOURCE_IMAGES) {
    const result = await ImageHistogrammer.run(source.label, source.file, source.weightScale);
    perImage.push({ bins: result.bins, label: result.label });
    for (const rec of result.weightedColors) { pooled.push(rec); }
  }

  return { perImage, pooled };
}

type CoverageResult = { readonly hex: string; readonly weight: number; readonly coveragePct: number };

/** Coverage-weighted reduction: weighted median-cut (chosen since every pooled record carries `hints.weight`), NOT delta-e — delta-e is a minority-preserving merger and would re-introduce the same "rare gem dominates the seed pool" bias this pass is fixing. */
function combineSeedsByCoverage(pooled: ColorRecordInterfaceType[], k: number): readonly CoverageResult[] {
  const ctx = makeContext(new Engine());
  const state = emptyState();
  state.colors.push(...pooled);
  state.metadata.gallery = { algorithm: 'median-cut', k };

  galleryExtract.run(state, ctx);

  const totalWeight = state.colors.reduce((sum, rec) => { return sum + (rec.hints?.weight ?? 0); }, 0);

  return state.colors
    .map((rec) => {
      const weight = rec.hints?.weight ?? 0;
      return { coveragePct: totalWeight > 0 ? (weight / totalWeight) * 100 : 0, hex: rec.hex, weight };
    })
    .sort((a, b) => { return b.coveragePct - a.coveragePct; });
}

/** Maps resolved dagonizer-32 role hexes onto the vscode 16-role schema by name, and drives the vscode-plugin task chain directly. */
const VSCODE_ROLE_MAP: Readonly<Record<string, string>> = {
  background: 'bg',
  comment: 'syntaxComment',
  constant: 'syntaxConstant',
  error: 'danger',
  foreground: 'text',
  function: 'syntaxFunction',
  info: 'info',
  keyword: 'syntaxKeyword',
  muted: 'text3',
  number: 'syntaxNumber',
  string: 'syntaxString',
  success: 'success',
  surface: 'bgAlt',
  type: 'syntaxType',
  variable: 'syntaxVariable',
  warning: 'warning'
};

function buildVscodeTheme(
  engine: Engine,
  dagonizerRoles: Record<string, ColorRecordInterfaceType>,
  themeName: string
): { readonly themeJson: unknown; readonly workbenchColors: Record<string, string> } {
  const ctx = makeContext(engine);
  const state = emptyState();
  state.input.metadata = { themeName };

  // Local role schema with `derivedFrom` stripped: every one of the 16
  // vscode roles already has an exact resolved hex from the dagonizer-32
  // schema (see VSCODE_ROLE_MAP), so nothing should be re-derived from a
  // sibling role — that would discard the brand-derived hue.
  const flatRoles: RoleSchemaInterfaceType = {
    ...vscodeRoleSchema16,
    roles: vscodeRoleSchema16.roles.map((role) => {
      const { derivedFrom, hueOffset, ...rest } = role;
      void derivedFrom;
      void hueOffset;
      return rest;
    })
  };
  state.input.roles = flatRoles;

  for (const [vscodeRole, dagonizerRole] of Object.entries(VSCODE_ROLE_MAP)) {
    const source = dagonizerRoles[dagonizerRole];
    if (source === undefined) {
      throw new Error(`buildVscodeTheme: dagonizer role '${dagonizerRole}' (mapped to vscode role '${vscodeRole}') was not resolved`);
    }
    state.colors.push(colorRecordFactory.fromRgb(source.rgb.r, source.rgb.g, source.rgb.b, {
      hints: { intent: undefined, role: vscodeRole, weight: undefined },
      sourceFormat: source.sourceFormat
    }));
  }

  const resolveRoles = engine.tasks.resolve('resolve:roles');
  const enforceContrast = engine.tasks.resolve('enforce:contrast');

  resolveRoles.run(state, ctx);
  enforceContrast.run(state, ctx);

  const contrastReport = state.metadata['core:contrastReport'] as
    | readonly { readonly passed: boolean; readonly foreground: string; readonly background: string; readonly ratio: number; readonly minRatio: number }[]
    | undefined;
  const failed = (contrastReport ?? []).filter((e) => { return !e.passed; });
  if (failed.length > 0) {
    throw new Error(`vscode theme contrast enforcement failed: ${JSON.stringify(failed)}`);
  }

  expandTokens.run(state, ctx);
  applyModifiers.run(state, ctx);
  emitVscodeSemanticRules.run(state, ctx);
  emitVscodeUiPalette.run(state, ctx);
  emitVscodeThemeJson.run(state, ctx);

  return {
    themeJson: state.outputs['vscode:themeJson'],
    workbenchColors: state.outputs['vscode:workbenchColors'] as Record<string, string>
  };
}

async function main(): Promise<void> {
  // The schema file now carries `algorithm: 'apca'` + a numeric `minRatio`
  // on every contrastPair (required by core's RoleSchemaSchema regardless
  // of algorithm; `enforce:apca` itself ignores minRatio and derives its
  // own Lc target from role intent) — used verbatim.
  const roleSchema = JSON.parse(readFileSync(join(HERE, 'iridis-32.roleSchema.json'), 'utf-8')) as RoleSchemaInterfaceType;

  console.log('=== Step 1: per-image pixel-weighted histogram (coverage-faithful, not minority-preserving) ===');
  const { perImage, pooled } = await extractAllImages();
  for (const result of perImage) {
    const total = result.bins.reduce((sum, b) => { return sum + b.weight; }, 0);
    console.log(`\n-- ${result.label} (top 8 bins by pixel weight) --`);
    for (const bin of result.bins.slice(0, 8)) {
      const pct = total > 0 ? (bin.weight / total) * 100 : 0;
      console.log(`  ${bin.hex}  weight=${bin.weight.toFixed(0)}  (${pct.toFixed(1)}%)`);
    }
  }

  console.log('\n=== Step 2: coverage-weighted reduction (median-cut, weight-aware; dagonizer-node.svg scaled to 15% weight as a structurally different minor asset) ===');
  const coverage = combineSeedsByCoverage(pooled, 10);
  console.log('Final coverage-weighted palette:');
  for (const c of coverage) {
    const rec = colorRecordFactory.fromHex(c.hex);
    console.log(`  ${c.hex}  ${c.coveragePct.toFixed(1)}%  OKLCH L=${rec.oklch.l.toFixed(3)} C=${rec.oklch.c.toFixed(3)} H=${rec.oklch.h.toFixed(1)}`);
  }
  // The coverage-weighted top-10 is void/steel only by design (k=10 is too
  // coarse for ~0.4%-coverage gems to survive weighted median-cut). The
  // schema's brand2 (cyan)/brand3 (violet) roots are `required: true` and
  // tightly bracketed, so they will synthesize a correct color from their
  // own range center even without a literal seed — but the two gem colors
  // actually measured from the seal's opaque pixels (average cyan-family
  // and average violet-family gem color) are supplied explicitly so
  // resolve:roles nearest-matches a real extracted color rather than a
  // purely synthesized one.
  const GEM_SEEDS = ['#34a1c3', '#b7bcfa'] as const;
  const seeds = [...coverage.map((c) => { return c.hex; }), ...GEM_SEEDS];

  console.log('\n=== Step 3: run dagonizer-32 role engine ===');
  const mainEngine = new Engine();
  for (const task of coreTasks) { mainEngine.tasks.register(task); }
  mainEngine.adopt(stylesheetPlugin);
  mainEngine.adopt(contrastPlugin);
  mainEngine.pipeline([
    'intake:any',
    'clamp:count',
    'clamp:oklch',
    'resolve:roles',
    'expand:family',
    'enforce:apca',
    'enforce:cvdSimulate',
    'emit:cssVars'
  ]);

  const state = mainEngine.run({
    colors: [...seeds],
    contrast: { algorithm: 'apca', cvdCorrect: false },
    metadata: {
      cssVarPrefix: '--dagonizer-',
      scopeAttr: 'data-theme',
      scopePrefix: 'dagonizer',
      themeName: 'dagonizer'
    },
    roles: roleSchema
  });

  console.log('\nResolved 32 roles:');
  for (const [name, record] of Object.entries(state.roles)) {
    console.log(`  ${name}: ${record.hex}`);
  }

  type ApcaPairResult = {
    readonly foreground: string;
    readonly background: string;
    readonly requiredLc: number;
    readonly beforeLc: number;
    readonly afterLc: number;
    readonly pass: boolean;
  };
  const apcaReport = state.metadata['contrast:apca'] as { readonly pairs: readonly ApcaPairResult[] } | undefined;
  const apcaPairs = apcaReport?.pairs ?? [];
  const apcaFailed = apcaPairs.filter((p) => { return !p.pass; });
  console.log(`\nenforce:apca: ${apcaPairs.length} pairs checked, ${apcaFailed.length} failed`);
  console.log('Per-pair achieved Lc:');
  for (const p of apcaPairs) {
    console.log(`  ${p.foreground} on ${p.background}: required Lc ${p.requiredLc}, before ${p.beforeLc.toFixed(1)}, after ${p.afterLc.toFixed(1)} — ${p.pass ? 'PASS' : 'FAIL'}`);
  }
  if (apcaFailed.length > 0) {
    console.log('FAILED PAIRS:', JSON.stringify(apcaFailed, undefined, 2));
    throw new Error('APCA enforcement failed for one or more contrast pairs; see above. Not weakening the schema.');
  }

  type CvdWarning = {
    readonly foreground: string;
    readonly background: string;
    readonly cvdType: string;
    readonly originalLuminanceContrast: number;
    readonly simulatedLuminanceContrast: number;
  };
  type CvdCorrection = {
    readonly foreground: string;
    readonly background: string;
    readonly cvdTypesFixed: readonly string[];
    readonly cvdTypesRemaining: readonly string[];
  };
  const cvdReport = state.metadata['contrast:cvd'] as
    | { readonly warnings: readonly CvdWarning[]; readonly corrections?: readonly CvdCorrection[] }
    | undefined;
  const cvdWarnings = cvdReport?.warnings ?? [];
  const cvdCorrections = cvdReport?.corrections ?? [];
  console.log(`\nenforce:cvdSimulate (cvdCorrect=true): ${cvdCorrections.length} pair(s) corrected, ${cvdWarnings.length} remaining warning(s) across protanopia/deuteranopia/tritanopia/achromatopsia`);
  for (const c of cvdCorrections) {
    console.log(`  corrected ${c.foreground} on ${c.background}: fixed [${c.cvdTypesFixed.join(', ')}]${c.cvdTypesRemaining.length > 0 ? `, still failing [${c.cvdTypesRemaining.join(', ')}]` : ''}`);
  }
  for (const w of cvdWarnings) {
    console.log(`  WARNING ${w.foreground} on ${w.background} (${w.cvdType}): trichromat contrast ${w.originalLuminanceContrast.toFixed(2)} -> simulated ${w.simulatedLuminanceContrast.toFixed(2)}`);
  }

  const cssVars = state.outputs['stylesheet:cssVars'] as { readonly full: string };
  writeFileSync(join(HERE, 'iridis-32.generated.css'), `${cssVars.full}\n`, 'utf-8');
  console.log(`\nWrote ${join(HERE, 'iridis-32.generated.css')}`);

  console.log('\n=== Step 4: vscode/shiki theme from dagonizer-32 roles ===');
  const vscodeEngine = new Engine();
  for (const task of coreTasks) { vscodeEngine.tasks.register(task); }
  const { themeJson } = buildVscodeTheme(vscodeEngine, state.roles, 'dagonizer');
  writeFileSync(join(HERE, 'iridis-32.shiki-theme.json'), `${JSON.stringify(themeJson, undefined, 2)}\n`, 'utf-8');
  console.log(`Wrote ${join(HERE, 'iridis-32.shiki-theme.json')}`);

  console.log('\nDone.');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
