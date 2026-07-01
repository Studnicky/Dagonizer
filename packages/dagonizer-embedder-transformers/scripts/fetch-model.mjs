/**
 * fetch-model.mjs: vendor the exact files `TransformersEmbedder` needs to
 * run `Xenova/all-MiniLM-L6-v2` fully offline, downloaded once from the
 * Hugging Face hub into `models/Xenova/all-MiniLM-L6-v2/`.
 *
 * Only the files the quantized (`dtype: 'q8'`) feature-extraction pipeline
 * actually reads at load time: `config.json`, `tokenizer.json`,
 * `tokenizer_config.json`, and `onnx/model_quantized.onnx`. Skips files
 * already present on disk, so re-running is a no-op after the first fetch.
 *
 * Run manually: `node scripts/fetch-model.mjs`
 */

import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
const HUB_BASE = `https://huggingface.co/${MODEL_ID}/resolve/main`;
const FILES = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_quantized.onnx'];

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const modelDir = join(packageRoot, 'models', MODEL_ID);

for (const file of FILES) {
  const destination = join(modelDir, file);
  if (existsSync(destination)) {
    console.log(`skip (already vendored): ${file}`);
    continue;
  }
  await mkdir(dirname(destination), { 'recursive': true });
  const url = `${HUB_BASE}/${file}`;
  console.log(`fetching ${url}`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`fetch failed for ${url}: ${String(response.status)} ${response.statusText}`);
  }
  const body = Buffer.from(await response.arrayBuffer());
  await writeFile(destination, body);
  console.log(`wrote ${file} (${String(body.byteLength)} bytes)`);
}
