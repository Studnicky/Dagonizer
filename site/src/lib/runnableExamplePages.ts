import type { RunnableExampleId } from '@/components/islands/runnableExampleContext';
import { SiteLinks } from '@/lib/links';

interface LinkItem {
  readonly href: string;
  readonly label: string;
}

interface RunnableExamplePageDefinition {
  readonly example: RunnableExampleId;
  readonly title: string;
  readonly description: string;
  readonly pageDescription: string;
  readonly crumbs: readonly LinkItem[];
  readonly runtimeSurfaces: readonly string[];
  readonly relatedLinks: readonly LinkItem[];
}

function docsCrumbs(slug: string, label: string): readonly LinkItem[] {
  return [
    { href: SiteLinks.site('/docs'), label: 'Docs' },
    { href: SiteLinks.site(SiteLinks.route('examples')), label: 'Examples' },
    { href: SiteLinks.site(SiteLinks.route(slug)), label },
  ];
}

const RUNNABLE_EXAMPLE_PAGES: Readonly<Record<RunnableExampleId, RunnableExamplePageDefinition>> = {
  'archivist': {
    'example': 'archivist',
    'title': 'The Archivist',
    'description': 'Runnable Dagonizer workflow for browser-based book research, memory recall, provenance, and checkpointed response generation.',
    'pageDescription': 'Registered Archivist DAG for classification, tool fan-out, memory recall, retry, and response composition.',
    'crumbs': docsCrumbs('examples/the-archivist', 'The Archivist'),
    'runtimeSurfaces': [
      'Intent classification, tool selection, and compose/validate retry all run as explicit placements in one registered DAG.',
      'The runner exposes backend selection, checkpoint save/resume, RDF memory, and provenance instead of hiding them behind app glue.',
      'Embedded search DAGs and tool DAG references show how one workflow can mix LLM decisions with deterministic routing and persistence.',
    ],
    'relatedLinks': [
      { href: SiteLinks.site(SiteLinks.route('guide/visualization')), label: 'Visualization guide' },
      { href: SiteLinks.site(SiteLinks.route('architecture')), label: 'Architecture' },
      { href: SiteLinks.site(SiteLinks.route('concepts')), label: 'Concepts' },
    ],
  },
  'cartographer': {
    'example': 'cartographer',
    'title': 'The Cartographer',
    'description': 'Runnable Dagonizer workflow for streaming intake, typed enrichment pipelines, geo resolution, and GDPR-aware aggregation.',
    'pageDescription': 'Registered Cartographer DAG for producer fan-in, worker-backed scatter, conditional routing, and resumable aggregation.',
    'crumbs': docsCrumbs('examples/the-cartographer', 'The Cartographer'),
    'runtimeSurfaces': [
      'Five producer feeds converge through an open gather, then reuse one typed event pipeline for enrichment and aggregation.',
      'Conditional geo-resolution and GDPR branches show how Dagonizer keeps skipped work visible instead of burying it inside handlers.',
      'Worker-backed scatter, streaming intake, and resumable fan-in run through the same runtime APIs without any LLM dependency.',
    ],
    'relatedLinks': [
      { href: SiteLinks.site(SiteLinks.route('examples/the-archivist')), label: 'The Archivist' },
      { href: SiteLinks.site(SiteLinks.route('guide/visualization')), label: 'Visualization guide' },
      { href: SiteLinks.site(SiteLinks.route('concepts')), label: 'Concepts' },
    ],
  },
  'dispatcher': {
    'example': 'dispatcher',
    'title': 'The Dispatcher',
    'description': 'Runnable Dagonizer workflow for support routing, operator handoff, and checkpointed resume from a parked execution cursor.',
    'pageDescription': 'Registered support DAG for customer routing, human escalation, and checkpoint-based resume.',
    'crumbs': docsCrumbs('examples/the-dispatcher', 'The Dispatcher'),
    'runtimeSurfaces': [
      'The support DAG parks at an operator boundary, captures a checkpoint, and resumes from the recorded cursor without rebuilding state.',
      'Classification mode, human gate, and response paths are explicit routes in the graph, not hidden UI branches.',
      'The same execute/resume contract also drives the CLI scenario, so the handoff pattern stays portable across interfaces.',
    ],
    'relatedLinks': [
      { href: SiteLinks.site(SiteLinks.route('examples/the-archivist')), label: 'The Archivist' },
      { href: SiteLinks.site(SiteLinks.route('examples/the-cartographer')), label: 'The Cartographer' },
      { href: SiteLinks.site(SiteLinks.route('guide/visualization')), label: 'Visualization guide' },
    ],
  },
};

export function runnableExamplePageFor(example: RunnableExampleId): RunnableExamplePageDefinition {
  return RUNNABLE_EXAMPLE_PAGES[example];
}
