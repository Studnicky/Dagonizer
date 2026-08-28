import mermaid from 'mermaid';
import { MermaidExplorer, MermaidRenderer } from '@studnicky/dagonizer/viz';

import type { DocDiagramEmbedPayload } from './doc-diagram-embed';

const ROOT_SELECTOR = '[data-doc-diagram]';
const PAYLOAD_SELECTOR = '[data-doc-diagram-payload]';
const FRAME_SELECTOR = '[data-doc-diagram-frame]';
const SOURCE_SELECTOR = '[data-doc-diagram-source] code';

let initialized = false;

function initializeMermaid(): void {
  if (initialized) {
    return;
  }

  mermaid.initialize({
    'startOnLoad': false,
    'securityLevel': 'strict',
    'theme': 'dark',
    'flowchart': {
      'htmlLabels': false,
      'nodeSpacing': 92,
      'rankSpacing': 104,
      'padding': 28,
      'useMaxWidth': false
    }
  });
  initialized = true;
}

function parsePayload(root: Element): DocDiagramEmbedPayload | undefined {
  const payloadNode = root.querySelector<HTMLScriptElement>(PAYLOAD_SELECTOR);
  if (payloadNode === null || payloadNode.textContent === null) {
    return undefined;
  }

  try {
    return JSON.parse(payloadNode.textContent) as DocDiagramEmbedPayload;
  } catch {
    return undefined;
  }
}

async function mountDiagram(root: Element, index: number): Promise<void> {
  const payload = parsePayload(root);
  const frame = root.querySelector<HTMLElement>(FRAME_SELECTOR);
  const source = root.querySelector<HTMLElement>(SOURCE_SELECTOR);

  if (payload === undefined || frame === null) {
    return;
  }

  initializeMermaid();

  const mermaidSource = MermaidRenderer.render(payload.dag);
  if (source !== null) {
    source.textContent = mermaidSource;
  }

  try {
    const result = await mermaid.render(`doc-diagram-${index}`, mermaidSource);
    frame.innerHTML = result.svg;
    if (typeof result.bindFunctions === 'function') {
      result.bindFunctions(frame);
    }
    MermaidExplorer.enhance(frame);
  } catch (error) {
    frame.innerHTML = `<pre><code>${String(error)}</code></pre>`;
  }
}

export function mountDocDiagramEmbeds(): void {
  const roots = Array.from(document.querySelectorAll(ROOT_SELECTOR));
  void Promise.all(roots.map((root, index) => mountDiagram(root, index)));
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      mountDocDiagramEmbeds();
    }, { once: true });
  } else {
    mountDocDiagramEmbeds();
  }
}
