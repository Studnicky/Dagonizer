export interface DocDiagramEmbedPayload {
  readonly dag: unknown;
  readonly title: string;
  readonly ariaLabel: string;
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function escapeHtmlText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function serializePayload(payload: DocDiagramEmbedPayload): string {
  return JSON.stringify(payload).replaceAll('<', '\\u003c');
}

export function renderDocDiagramEmbed(payload: DocDiagramEmbedPayload): string {
  const jsonLd = JSON.stringify(payload.dag, null, 2);
  return [
    `<section class="doc-diagram" data-doc-diagram aria-label="${escapeHtmlAttribute(payload.ariaLabel)}">`,
    '  <header class="doc-diagram-header">',
    `    <h3>${escapeHtmlText(payload.title)}</h3>`,
    '    <span class="doc-diagram-eyebrow">Diagram reference</span>',
    '  </header>',
    '  <div class="doc-diagram-layout">',
    '    <figure class="doc-diagram-panel doc-diagram-figure">',
    '      <figcaption class="doc-diagram-title">Mermaid render</figcaption>',
    '      <div class="doc-diagram-frame" data-doc-diagram-frame>',
    '        <p class="doc-diagram-status">Rendering diagram…</p>',
    '      </div>',
    '    </figure>',
    '    <div class="doc-diagram-stack">',
    '      <details class="doc-diagram-panel" open>',
    '        <summary class="doc-diagram-title">JSON-LD</summary>',
    `        <pre><code>${escapeHtmlText(jsonLd)}</code></pre>`,
    '      </details>',
    '      <details class="doc-diagram-panel">',
    '        <summary class="doc-diagram-title">Mermaid source</summary>',
    '        <pre data-doc-diagram-source><code></code></pre>',
    '      </details>',
    '    </div>',
    '  </div>',
    `  <script type="application/json" data-doc-diagram-payload>${serializePayload(payload)}</script>`,
    '</section>'
  ].join('\n');
}
