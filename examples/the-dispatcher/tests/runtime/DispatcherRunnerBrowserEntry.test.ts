import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { build } from 'vite';
import type { OutputAsset, OutputChunk } from 'rolldown';

import { dispatcherDeployPayloadPolicy } from '../../runtime/DispatcherDeployPayloadPolicy.ts';

const root = fileURLToPath(new URL('../..', import.meta.url));
const configFile = fileURLToPath(new URL('../../vite.config.ts', import.meta.url));

let chunks: readonly OutputChunk[] = [];
let assets: readonly OutputAsset[] = [];

function collectInitialChunks(entry: OutputChunk, byFileName: ReadonlyMap<string, OutputChunk>): ReadonlySet<string> {
  const initial = new Set<string>();
  const pending = [entry.fileName];
  while (pending.length > 0) {
    const fileName = pending.pop();
    if (fileName === undefined || initial.has(fileName)) continue;
    initial.add(fileName);
    const chunk = byFileName.get(fileName);
    if (chunk !== undefined) pending.push(...chunk.imports);
  }
  return initial;
}

function collectDynamicChunks(
  initial: ReadonlySet<string>,
  byFileName: ReadonlyMap<string, OutputChunk>,
): ReadonlySet<string> {
  const dynamic = new Set<string>();
  const pending = [...initial].flatMap(
    (fileName) => byFileName.get(fileName)?.dynamicImports ?? [],
  );
  while (pending.length > 0) {
    const fileName = pending.pop();
    if (fileName === undefined || dynamic.has(fileName)) continue;
    dynamic.add(fileName);
    const chunk = byFileName.get(fileName);
    if (chunk !== undefined) pending.push(...chunk.imports, ...chunk.dynamicImports);
  }
  return dynamic;
}

void describe('Dispatcher browser entry build graph', () => {
  before(async () => {
    const result = await build({
      configFile,
      root,
      'build': { 'write': false },
      'logLevel': 'silent',
    });
    const outputs = Array.isArray(result) ? result : [result];
    const emitted: Array<OutputAsset | OutputChunk> = [];
    for (const output of outputs) {
      if (!('output' in output)) throw new Error('expected an executable Vite build output');
      emitted.push(...output.output);
    }
    chunks = emitted.filter((item): item is OutputChunk => item.type === 'chunk');
    assets = emitted.filter((item): item is OutputAsset => item.type === 'asset');
  });

  void it('keeps named provider and transformer runtimes outside the initial static graph', () => {
    const entry = chunks.find((chunk) => chunk.isEntry);
    assert.ok(entry !== undefined, 'expected one browser entry chunk');
    const byFileName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
    const initial = collectInitialChunks(entry, byFileName);
    const providerRuntime = chunks.find(
      (chunk) => chunk.name === dispatcherDeployPayloadPolicy.providerRuntimeChunk,
    );
    const transformerRuntime = chunks.find(
      (chunk) => chunk.name === dispatcherDeployPayloadPolicy.transformerRuntimeChunk,
    );
    const onnxRuntime = chunks.find(
      (chunk) => chunk.name === dispatcherDeployPayloadPolicy.onnxRuntimeChunk,
    );

    assert.ok(providerRuntime !== undefined, 'expected named provider runtime chunk');
    assert.ok(transformerRuntime !== undefined, 'expected named transformer runtime chunk');
    assert.ok(onnxRuntime !== undefined, 'expected named ONNX runtime chunk');
    assert.equal(initial.has(providerRuntime.fileName), false);
    assert.equal(initial.has(transformerRuntime.fileName), false);
    assert.equal(initial.has(onnxRuntime.fileName), false);
  });

  void it('exposes model and WASM payloads only behind the deliberate transformer dynamic boundary', () => {
    const entry = chunks.find((chunk) => chunk.isEntry);
    assert.ok(entry !== undefined, 'expected one browser entry chunk');
    const byFileName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
    const initial = collectInitialChunks(entry, byFileName);
    const dynamic = collectDynamicChunks(initial, byFileName);
    const providerRuntime = chunks.find(
      (chunk) => chunk.name === dispatcherDeployPayloadPolicy.providerRuntimeChunk,
    );
    const transformerRuntime = chunks.find(
      (chunk) => chunk.name === dispatcherDeployPayloadPolicy.transformerRuntimeChunk,
    );
    const onnxRuntime = chunks.find(
      (chunk) => chunk.name === dispatcherDeployPayloadPolicy.onnxRuntimeChunk,
    );

    assert.ok(providerRuntime !== undefined, 'expected named provider runtime chunk');
    assert.ok(transformerRuntime !== undefined, 'expected named transformer runtime chunk');
    assert.ok(onnxRuntime !== undefined, 'expected named ONNX runtime chunk');
    assert.equal(dynamic.has(providerRuntime.fileName), true);
    assert.equal(dynamic.has(transformerRuntime.fileName), true);
    assert.equal(dynamic.has(onnxRuntime.fileName), true);
    assert.equal(
      assets.some((asset) => asset.fileName.startsWith(dispatcherDeployPayloadPolicy.modelsAssetPrefix)),
      true,
    );
    assert.equal(
      assets.some((asset) => asset.fileName.startsWith(dispatcherDeployPayloadPolicy.ortAssetPrefix)),
      true,
    );
  });
});
