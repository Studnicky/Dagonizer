import { posix } from 'node:path';
import { marked } from 'marked';
import { createHighlighter, type Highlighter, type ThemeRegistrationRaw } from 'shiki';
import { SiteLinks } from '@/lib/links';
import dagonizerShikiThemeSource from '@/theme/dagonizer-shiki-theme.json';

const DOC_CODE_LANGUAGES = [
  'ts',
  'tsx',
  'js',
  'jsx',
  'json',
  'jsonc',
  'bash',
  'shellscript',
  'yaml',
  'markdown',
  'mermaid',
  'text'
];

const DOC_CODE_LANGUAGE_ALIASES = new Map<string, string>([
  ['typescript', 'ts'],
  ['javascript', 'js'],
  ['sh', 'bash'],
  ['shell', 'bash'],
  ['md', 'markdown'],
  ['yml', 'yaml'],
  ['plaintext', 'text'],
  ['plain', 'text']
]);

const dagonizerShikiTheme: ThemeRegistrationRaw = {
  name: dagonizerShikiThemeSource.name,
  type: dagonizerShikiThemeSource.type === 'light' ? 'light' : 'dark',
  colors: dagonizerShikiThemeSource.colors,
  tokenColors: dagonizerShikiThemeSource.tokenColors,
  settings: dagonizerShikiThemeSource.tokenColors
};

let docHighlighterPromise: Promise<Highlighter> | undefined;

function docHighlighter(): Promise<Highlighter> {
  docHighlighterPromise ??= createHighlighter({
    themes: [dagonizerShikiTheme],
    langs: DOC_CODE_LANGUAGES
  });
  return docHighlighterPromise;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function plainCodeBlock(text: string): string {
  return `<pre><code>${escapeHtml(text)}</code></pre>`;
}

function renderDocCodeBlock(highlighter: Highlighter, text: string, lang: string | undefined): string {
  const normalizedLang = lang === undefined || lang.length === 0 ? 'text' : lang.toLowerCase();
  const resolvedLang = DOC_CODE_LANGUAGE_ALIASES.get(normalizedLang) ?? normalizedLang;

  if (!DOC_CODE_LANGUAGES.includes(resolvedLang)) {
    return plainCodeBlock(text);
  }

  try {
    return highlighter.codeToHtml(text, {
      lang: resolvedLang,
      theme: dagonizerShikiTheme.name ?? 'dagonizer'
    });
  } catch {
    return plainCodeBlock(text);
  }
}

interface DocHeading {
  readonly depth: number;
  readonly slug: string;
  readonly text: string;
}

const DOC_ROOT_SEGMENTS = new Set([
  'architecture',
  'concepts',
  'examples',
  'experiments',
  'getting-started',
  'guide',
  'index',
  'internal',
  'reference'
]);

const DOC_SECTION_ALIASES = [
  ['What It Is', 'Runtime Surface', 'Scatter-to-Gather Contract', 'Lifecycle Projection', 'CLI Host', 'Stream Producer Boundary', 'Checkpoint Model', 'State Model', 'ReAct Mapping', 'Rendering Surface', 'Dependency Model', 'Plugin Assembly', 'Observer Surface', 'Persistence Model', 'Cancellation Contract', 'Accessor Contract', 'Distribution Model', 'Batch Execution Model', 'Document Model', 'Parking Model', 'Tuning Surface', 'Reservoir Model', 'Runtime Utilities', 'Gather and Reducer Surface', 'Host Adapter Surface', 'Shared Store Surface', 'Execution Handle', 'Checkpoint Surface', 'Integration Surface', 'Placement Surface', 'Adapter Surface', 'Handoff Surface', 'Container Surface', 'Lifecycle Surface', 'Validation Surface', 'Error Surface', 'Deterministic Runtime Surface', 'Renderer Surface', 'Dispatcher Surface', 'Schema Surface', 'Public API Surface', 'Triple-term Surface', 'Runtime Constant Surface', 'Accessor Replacement Surface', 'Remote Store Surface', 'Registry Identity Surface', 'Node Base-class Surface', 'Deterministic Time Surface', 'Tool Fan-out Surface', 'Gather Strategy Surface', 'Incremental Fold Surface', 'Durable Scatter Resume', 'Async Source Surface', 'Execution Stream Surface', 'Producer Feed Surface', 'Durable Cursor Surface', 'Canonical DAG Surface', 'Builder Authoring Surface', 'Ingest Validation Surface', 'Retry Surface', 'Phase Placement Surface', 'Producer Bridge Surface', 'Conversation Workflow Surface', 'Lifecycle Hook Surface', 'Retry Timing Surface', 'Model Provider Surface', 'Embedding Provider Surface', 'Tool Dispatch Surface', 'Agent Loop Surface', 'Park-and-Resume Surface', 'Plugin DAG Surface', 'Resume Boundary', 'Terminal Outcome Surface', 'Shared Memory Surface', 'Operator Handoff Surface', 'Container Role Surface', 'Role-bound Execution Surface', 'Store-backed State Surface'],
  ['Diagrams, Examples, and Outputs', 'Flow and Runtime Behavior', 'Registered Flow', 'Examples and References', 'Registered Flows', 'Rendered Outputs', 'Observable Flow', 'Persistence Lifecycle', 'Abort and Deadline Flow', 'Path Resolution Surface', 'Worker and Handoff Flows', 'Reservoir-backed Example Flow', 'Loaded Document and Round-Trip', 'Escalation Flow', 'Runtime Control Points', 'Buffered Scatter Flow', 'References and Test Surfaces', 'Flow and Registry References', 'Trigger and Runner References', 'Store and Checkpoint References', 'Adjacent Runtime References', 'Resume and Snapshot References', 'Default Implementations and Extensions', 'Schema and Contract References', 'Application and Contract References', 'Transport and Deployment References', 'Worker and Role References', 'Execution and Hook References', 'Schema and Error References', 'Validation and Runtime References', 'Runtime Provider References', 'Rendering References', 'Registry and Runtime References', 'Schema and Validation References', 'Entry-point References', 'Probe and Encoding References', 'CLI Output and Guard Coverage', 'CLI Wiring and Path Resolution', 'CLI Lifecycle and Lease Flow', 'Collision and Prefix Cases', 'Minimal Routing Flow', 'Timeout Flow', 'Scout Flow and Container Path', 'Cartographer Gather Flows', 'Incremental Gather Flow', 'Checkpointed Scatter Flow', 'Producer-feed Scatter Flow', 'Caller Observation Flow', 'Feed-in Topology', 'Resumable Stream Flow', 'Canonical Document and Runtime', 'Typed Routing and Placement API', 'Loaded Document and Validation Path', 'Retry Loop and Policy Flow', 'Phase Ordering Flow', 'Channel and Producer Flows', 'Conversation Topologies', 'Observable Support Flow', 'Retry and Salvage Flow', 'Adapter-backed Agent Flow', 'Semantic Recall Flow', 'Model-to-Tool Flow', 'Registered Agent Topology', 'Parked Support Flow', 'Plugin-backed Ingest Flow', 'Checkpoint Lifecycle', 'Completed and Failed Endpoints', 'Store-backed Archivist Flow', 'Checkpointed Handoff Flow', 'Worker-backed Scatter Flow', 'Multi-role Worker Topology', 'Shared Store and Checkpoint Flow'],
  ['How It Works', 'Host Wiring', 'Gather Semantics', 'Projection Boundary', 'Trigger and Projection Boundary', 'Inner-to-Outer Stream Wiring', 'Persistence Contract', 'Graph-backed Access', 'Streaming and Recall', 'Renderer Contracts', 'Injection Contract', 'Registration Contract', 'Observation Contract', 'Store Contract', 'Signal Propagation', 'Read/Write Contract', 'Container and Channel Contract', 'Work-set Scheduler', 'Serialization Contract', 'Park and Resume Contract', 'Boundary-level Controls', 'Release Contract', 'Provider and Policy Model', 'Strategy Resolution Model', 'Trigger Loop Contract', 'Snapshot and Mutation Contract', 'Consumption Model', 'Capture and Restore Contract', 'Binding Model', 'Placement Model', 'Provider Abstraction Model', 'Publish Contract', 'Isolate Execution Model', 'Transition Model', 'Ingest Boundary Model', 'Error Model', 'Virtual Time Model', 'Renderer Model', 'Registration and Execution Model', 'Schema Derivation Model', 'Export Boundary Model', 'Basic Encoding Model', 'Value-and-Type Contract', 'Accessor Delegation Model', 'Remote Store Contract', 'Prefix Expansion Model', 'Declared-output Model', 'Virtual Scheduler Model', 'Scatter Body and Gather Model', 'Merge and Reducer Model', 'Reduce-versus-Finalize Model', 'Inbox and Ack Model', 'Pull-backpressure Model', 'Execution Wrapper Model', 'Feed DAG and Intake Model', 'Cursor and Replay Model', 'Authoring Convergence Model', 'Builder Emission Model', 'Schema Boundary Model', 'Flow-loop versus Policy Model', 'Pre/Post Execution Model', 'Push-to-Pull Bridge Model', 'Turn, Park, and Stream Model', 'Hook Projection Model', 'Topology-versus-Timing Model', 'Adapter Injection Model', 'Embedder Provisioning Model', 'Tool DAG Dispatch Model', 'Loop Assembly Model', 'Correlation and Resume Model', 'Plugin Registration Model', 'Capture and Restore Model', 'Outcome Propagation Model', 'Store Injection Model', 'Cross-actor Resume Model', 'Role Binding Model', 'Role-to-Backend Model', 'Store versus Mapping Model'],
  ['Code Samples'],
  ['What It Lets You Do', 'Operational Uses', 'Usage', 'Deployment Uses'],
  ['Details for Nerds', 'Runtime Notes'],
  ['Related Concepts']
] as const;

const DOC_CONTRACT_ROUTE_PREFIXES = ['guide/', 'examples/', 'reference/'];

const CANONICAL_DOC_SECTION_ORDER = DOC_SECTION_ALIASES.map((aliases) => aliases[0]);

interface DocSection {
  readonly headingText: string;
  readonly raw: string;
  readonly originalIndex: number;
}

function isDocContractSlug(slug: string | undefined): boolean {
  return slug !== undefined && DOC_CONTRACT_ROUTE_PREFIXES.some(prefix => slug.startsWith(prefix));
}

function splitDocSections(body: string): {
  readonly preamble: string;
  readonly sections: readonly DocSection[];
} {
  const lines = body.split('\n');
  const sectionBoundaryPattern = /^##(?!#)\s+(.+)$/;
  const boundaries: Array<{ readonly lineIndex: number; readonly headingText: string }> = [];
  let inCodeFence = false;

  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();

    if (trimmed.startsWith('```')) {
      inCodeFence = !inCodeFence;
      continue;
    }

    if (inCodeFence) {
      continue;
    }

    const match = sectionBoundaryPattern.exec(trimmed);
    if (match === null) {
      continue;
    }

    boundaries.push({
      lineIndex: index,
      headingText: extractExplicitHeadingSlug(match[1]).displayText
    });
  }

  if (boundaries.length === 0) {
    return { preamble: body, sections: [] };
  }

  const preamble = lines.slice(0, boundaries[0].lineIndex).join('\n');
  const sections: DocSection[] = boundaries.map((boundary, boundaryIndex) => {
    const endLineIndex = boundaryIndex + 1 < boundaries.length ? boundaries[boundaryIndex + 1].lineIndex : lines.length;
    return {
      headingText: boundary.headingText,
      raw: lines.slice(boundary.lineIndex, endLineIndex).join('\n'),
      originalIndex: boundaryIndex
    };
  });

  return { preamble, sections };
}

function canonicalDocSectionSortKey(sections: readonly DocSection[]): readonly number[] {
  let mostRecentCanonicalIndex = -1;
  let nonCanonicalCounter = 0;

  return sections.map(section => {
    const canonicalIndex = DOC_SECTION_ALIASES.findIndex((aliases) => aliases.includes(section.headingText));
    if (canonicalIndex !== -1) {
      mostRecentCanonicalIndex = canonicalIndex;
      nonCanonicalCounter = 0;
      return canonicalIndex * 1000;
    }

    nonCanonicalCounter += 1;
    return mostRecentCanonicalIndex * 1000 + nonCanonicalCounter;
  });
}

function reorderDocSections(sections: readonly DocSection[]): readonly DocSection[] {
  const sortKeys = canonicalDocSectionSortKey(sections);
  return sections
    .map((section, index) => ({ section, sortKey: sortKeys[index] }))
    .sort((left, right) => left.sortKey - right.sortKey)
    .map(entry => entry.section);
}

function reorderDocBody(body: string): string {
  const { preamble, sections } = splitDocSections(body);
  if (sections.length === 0) {
    return body;
  }

  const reorderedRaw = reorderDocSections(sections).map(section => section.raw).join('\n');
  return preamble.length > 0 ? `${preamble}\n${reorderedRaw}` : reorderedRaw;
}

function inlineText(text: string): string {
  return decodeHtmlEntities(text)
    .replace(/<[^>]+>/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/[*_>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeHtmlEntities(text: string): string {
  return text
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
    .replaceAll('&#39;', "'")
    .replaceAll('&quot;', '"');
}

function extractExplicitHeadingSlug(text: string): {
  readonly displayText: string;
  readonly slug: string | undefined;
} {
  const rawText = decodeHtmlEntities(text).replace(/<[^>]+>/g, '').trim();
  const explicitMatch = /\s+\{#([A-Za-z0-9_-]+)\}$/.exec(rawText);
  if (explicitMatch === null) {
    return {
      displayText: inlineText(text),
      slug: undefined
    };
  }

  return {
    displayText: inlineText(rawText.slice(0, explicitMatch.index).trimEnd()),
    slug: explicitMatch[1]
  };
}

function slugifyHeading(text: string): string {
  const { displayText, slug } = extractExplicitHeadingSlug(text);
  if (slug !== undefined) {
    return slug;
  }

  return stripGenericSegments(displayText)
    .toLowerCase()
    .replace(/&[a-z]+;/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

function stripGenericSegments(text: string): string {
  return text.replace(/<[^>]+>/g, '');
}

function getLeadingMarkdownTitle(body: string): string | undefined {
  const lines = body.split('\n');
  let inCodeFence = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith('```')) {
      inCodeFence = !inCodeFence;
      continue;
    }

    if (inCodeFence || trimmed.length === 0) {
      continue;
    }

    const match = /^#\s+(.+)$/.exec(trimmed);
    if (match === null) {
      return undefined;
    }

    return inlineText(match[1]);
  }

  return undefined;
}

function toMarkdownCallout(eyebrow: string, title: string, body: string): string {
  return [
    `> ${eyebrow}`,
    `>`,
    `> **${title}**`,
    `> ${body}`,
    ''
  ].join('\n');
}

function transformSpecialEmbeds(body: string): string {
  return body
    .replace(
      /<ExperimentalHomeHero\s*\/?>/g,
      toMarkdownCallout(
        'Home overview',
        'Runtime overview',
        'A short overview of Dagonizer’s core runtime capabilities in one place.'
      )
    );
}

function stripUnsupportedDocTags(body: string): string {
  const lines = body.split('\n');
  const kept: string[] = [];
  let inCodeFence = false;

  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      inCodeFence = !inCodeFence;
      kept.push(line);
      continue;
    }

    if (!inCodeFence) {
      if (/^\s*<\/?ClientOnly>\s*$/.test(line)) {
        continue;
      }

      if (/^\s*<[A-Z][A-Za-z0-9]*(?:\s+[^>]*)?\/?>\s*$/.test(line)) {
        continue;
      }
    }

    kept.push(line);
  }

  return kept.join('\n');
}

function stripLeadingTitleHeading(body: string, title: string): string {
  const expectedTitle = inlineText(title).toLowerCase();
  const lines = body.split('\n');
  let inCodeFence = false;

  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();

    if (trimmed.startsWith('```')) {
      inCodeFence = !inCodeFence;
      continue;
    }

    if (inCodeFence || trimmed.length === 0) {
      continue;
    }

    const match = /^#\s+(.+)$/.exec(trimmed);
    if (match === null) {
      return body;
    }

    if (inlineText(match[1]).toLowerCase() !== expectedTitle) {
      return body;
    }

    const nextIndex = index + 1 < lines.length && lines[index + 1].trim().length === 0 ? index + 2 : index + 1;
    return [...lines.slice(0, index), ...lines.slice(nextIndex)].join('\n');
  }

  return body;
}

function collectHeadings(body: string): readonly DocHeading[] {
  const headings: DocHeading[] = [];
  const lines = body.split('\n');
  let inCodeFence = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith('```')) {
      inCodeFence = !inCodeFence;
      continue;
    }

    if (inCodeFence) {
      continue;
    }

    const match = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (match === null) {
      continue;
    }

    const text = extractExplicitHeadingSlug(match[2]).displayText;
    if (text.length === 0) {
      continue;
    }

    headings.push({
      depth: match[1].length,
      slug: slugifyHeading(text),
      text
    });
  }

  return headings;
}

function isExternalHref(href: string): boolean {
  return /^(?:[a-z]+:)?\/\//i.test(href) || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:');
}

function isRepositorySourcePath(path: string): boolean {
  return /\.(?:tsx?|jsx?|json)$/.test(path);
}

function resolveDocHref(currentSlug: string | undefined, href: string): string {
  if (href.length === 0 || href === '#' || href.startsWith('#') || isExternalHref(href)) {
    return href;
  }

  const hashIndex = href.indexOf('#');
  const hrefWithoutHash = hashIndex === -1 ? href : href.slice(0, hashIndex);
  const hashSuffix = hashIndex === -1 ? '' : href.slice(hashIndex);
  const queryIndex = hrefWithoutHash.indexOf('?');
  const pathPart = queryIndex === -1 ? hrefWithoutHash : hrefWithoutHash.slice(0, queryIndex);
  const querySuffix = queryIndex === -1 ? '' : hrefWithoutHash.slice(queryIndex);

  if (pathPart === '' || pathPart === '.') {
    const currentRoute = SiteLinks.route(currentSlug ?? 'index');
    return `${SiteLinks.site(currentRoute)}${querySuffix}${hashSuffix}`;
  }

  if (pathPart === '/') {
    return `${SiteLinks.site('/')}${querySuffix}${hashSuffix}`;
  }

  const currentDir = currentSlug === undefined || currentSlug === 'index' ? '.' : posix.dirname(currentSlug);
  if (isRepositorySourcePath(pathPart)) {
    const repositoryPath = posix.join('docs', currentDir, pathPart);
    return `${SiteLinks.repository(repositoryPath)}${querySuffix}${hashSuffix}`;
  }

  if (pathPart.startsWith('/')) {
    if (pathPart === '/docs') {
      return `${SiteLinks.site('/docs')}${querySuffix}${hashSuffix}`;
    }

    const withoutExtension = pathPart.endsWith('.md') ? pathPart.slice(0, -'.md'.length) : pathPart;
    const withoutIndex = withoutExtension.endsWith('/index')
      ? withoutExtension.slice(0, -'/index'.length)
      : withoutExtension;
    const routePath = withoutIndex.startsWith('/docs/') ? withoutIndex.slice('/docs'.length) : withoutIndex;
    const absoluteSlug = routePath.length === 0 ? 'index' : routePath.slice(1);
    const firstSeparator = absoluteSlug.indexOf('/');
    const firstSegment = firstSeparator === -1 ? absoluteSlug : absoluteSlug.slice(0, firstSeparator);
    const targetPath = DOC_ROOT_SEGMENTS.has(firstSegment)
      ? SiteLinks.site(SiteLinks.route(absoluteSlug))
      : SiteLinks.site(pathPart);
    return `${targetPath}${querySuffix}${hashSuffix}`;
  }

  const relativePath = posix.join(currentDir, pathPart);
  const withoutExtension = relativePath.endsWith('.md') ? relativePath.slice(0, -'.md'.length) : relativePath;
  const withoutIndex = withoutExtension.endsWith('/index')
    ? withoutExtension.slice(0, -'/index'.length)
    : withoutExtension;
  const resolvedSlug = withoutIndex.length === 0 ? 'index' : withoutIndex;
  return `${SiteLinks.site(SiteLinks.route(resolvedSlug))}${querySuffix}${hashSuffix}`;
}

export const DocPageRenderer = {
  leadingTitle(body: string): string | undefined {
    return getLeadingMarkdownTitle(body);
  },

  async render(body: string, options?: {
    readonly title?: string;
    readonly slug?: string;
  }): Promise<{
    readonly html: string;
    readonly headings: readonly DocHeading[];
  }> {
    const transformedBody = stripUnsupportedDocTags(transformSpecialEmbeds(body));
    const titleStrippedBody = options?.title ? stripLeadingTitleHeading(transformedBody, options.title) : transformedBody;
    const renderBody = isDocContractSlug(options?.slug) ? reorderDocBody(titleStrippedBody) : titleStrippedBody;
    const headings = collectHeadings(renderBody);
    const highlighter = await docHighlighter();
    const renderer = new marked.Renderer();

    renderer.code = ({ text, lang }) => renderDocCodeBlock(highlighter, text, lang);

    renderer.heading = ({ tokens, depth }) => {
      const renderedText = renderer.parser.parseInline(tokens);
      const { displayText, slug } = extractExplicitHeadingSlug(renderedText);
      const headingSlug = slug ?? slugifyHeading(displayText);
      const classAttribute = depth === 2 && isDocContractSlug(options?.slug)
        ? ' class="doc-heading-secondary"'
        : '';
      return `<h${depth} id="${headingSlug}"${classAttribute}>${displayText}</h${depth}>`;
    };

    renderer.link = ({ href, title, tokens }) => {
      const text = renderer.parser.parseInline(tokens);
      const resolvedHref = resolveDocHref(options?.slug, href ?? '');
      const titleAttribute = title ? ` title="${title}"` : '';
      return `<a href="${resolvedHref}"${titleAttribute}>${text}</a>`;
    };

    return {
      html: await marked.parse(renderBody, {
        gfm: true,
        renderer
      }),
      headings
    };
  }
};
