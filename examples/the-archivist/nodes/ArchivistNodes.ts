/**
 * ArchivistNodes: the single shared registry of node instances.
 *
 * Every services-injected node and every pure node the archivist app uses is
 * constructed EXACTLY ONCE here, then shared across all three bundle factories
 * (book-search-scatter, compose-retry-loop, the-archivist parent).
 *
 * Why one shared set: services-injected nodes appear in more than one bundle
 * (e.g. extract-query, decide-tools, record-findings). The DagRegistrar is
 * idempotent for the SAME instance (Object.is) but rejects a DIFFERENT instance
 * registered under the same node name/IRI. Constructing each node once and
 * passing this object to every factory makes the duplicate registrations refer
 * to identical instances, so the registrar accepts them.
 *
 * Construction discipline (Node strip-only type syntax): no parameter
 * properties. Every field is declared explicitly and assigned in the
 * constructor body in declaration order, preserving V8 hidden-class stability.
 * `ArchivistNodes.build(services)` is the canonical factory (noun.verb).
 */

import type { ArchivistServices } from '../services.ts';

import { ClassifyIntentNode }        from './classifyIntent.ts';
import { ComposeMemoryResponseNode } from './composeMemoryResponse.ts';
import { ComposeResponseNode, ValidateResponseNode } from './composeResponse.ts';
import { DecideToolsNode }           from './decideTools.ts';
import { ExtractQueryNode }          from './extractQuery.ts';
import { HasCitationsGateNode }      from './hasCitationsGate.ts';
import { RankCandidatesNode }        from './rankCandidates.ts';
import { RecallCandidatesNode }      from './recallCandidates.ts';
import { RecallContextNode }         from './recallContext.ts';
import { RecallMemoriesNode }        from './recallMemories.ts';
import { RecallPastVisitsNode }      from './recallPastVisits.ts';
import { RecommendSimilarNode }      from './recommendSimilar.ts';
import { RecordFindingsNode }        from './recordFindings.ts';
import {
  ComposeEmptyResponseNode,
  DeclineOffTopicNode,
  ParkForInputNode,
  RespondToVisitorNode,
} from './respondToVisitor.ts';

import { BuildBookWorksetsNode } from './buildBookWorksets.ts';
import { GroupByYearNode }       from './groupByYear.ts';
import { MergeCandidatesNode }   from './mergeCandidates.ts';
import { PickBestMatchNode }     from './pickBestMatch.ts';
import { PreRunSetupNode }       from './preRunSetup.ts';
import { RankByRatingNode }      from './rankByRating.ts';
import {
  ClassifyIntentSalvageNode,
  ComposeEmptyResponseSalvageNode,
  ComposeMemoryResponseSalvageNode,
  ComposeResponseSalvageNode,
  DecideToolsSalvageNode,
  ExtractQuerySalvageNode,
  RankCandidatesSalvageNode,
} from './salvage.ts';

/**
 * One instance of every node the three bundles reference. Services-injected
 * nodes take `services`; pure nodes are stateless.
 */
export class ArchivistNodes {
  readonly recallContext:         RecallContextNode;
  readonly classifyIntent:        ClassifyIntentNode;
  readonly extractQuery:          ExtractQueryNode;
  readonly decideTools:           DecideToolsNode;
  readonly recallCandidates:      RecallCandidatesNode;
  readonly rankCandidates:        RankCandidatesNode;
  readonly recordFindings:        RecordFindingsNode;
  readonly hasCitationsGate:      HasCitationsGateNode;
  readonly recallPastVisits:      RecallPastVisitsNode;
  readonly recallMemories:        RecallMemoriesNode;
  readonly composeMemoryResponse: ComposeMemoryResponseNode;
  readonly recommendSimilar:      RecommendSimilarNode;
  readonly composeEmptyResponse:  ComposeEmptyResponseNode;
  readonly composeResponse:       ComposeResponseNode;
  readonly validateResponse:      ValidateResponseNode;

  readonly groupByYear:       GroupByYearNode;
  readonly pickBestMatch:     PickBestMatchNode;
  readonly rankByRating:      RankByRatingNode;
  readonly mergeCandidates:   MergeCandidatesNode;
  readonly buildBookWorksets: BuildBookWorksetsNode;
  readonly preRunSetup:       PreRunSetupNode;
  readonly parkForInput:      ParkForInputNode;
  readonly respondToVisitor:  RespondToVisitorNode;
  readonly declineOffTopic:   DeclineOffTopicNode;

  readonly extractQuerySalvage:         ExtractQuerySalvageNode;
  readonly decideToolsSalvage:          DecideToolsSalvageNode;
  readonly classifyIntentSalvage:       ClassifyIntentSalvageNode;
  readonly rankCandidatesSalvage:       RankCandidatesSalvageNode;
  readonly composeResponseSalvage:      ComposeResponseSalvageNode;
  readonly composeEmptyResponseSalvage: ComposeEmptyResponseSalvageNode;
  readonly composeMemoryResponseSalvage: ComposeMemoryResponseSalvageNode;

  constructor(services: ArchivistServices) {
    this.recallContext         = new RecallContextNode(services);
    this.classifyIntent        = new ClassifyIntentNode(services);
    this.extractQuery          = new ExtractQueryNode(services);
    this.decideTools           = new DecideToolsNode(services);
    this.recallCandidates      = new RecallCandidatesNode(services);
    this.rankCandidates        = new RankCandidatesNode(services);
    this.recordFindings        = new RecordFindingsNode(services);
    this.hasCitationsGate      = new HasCitationsGateNode(services);
    this.recallPastVisits      = new RecallPastVisitsNode(services);
    this.recallMemories        = new RecallMemoriesNode(services);
    this.composeMemoryResponse = new ComposeMemoryResponseNode(services);
    this.recommendSimilar      = new RecommendSimilarNode(services);
    this.composeEmptyResponse  = new ComposeEmptyResponseNode(services);
    this.composeResponse       = new ComposeResponseNode(services);
    this.validateResponse      = new ValidateResponseNode(services);

    this.groupByYear       = new GroupByYearNode();
    this.pickBestMatch     = new PickBestMatchNode();
    this.rankByRating      = new RankByRatingNode();
    this.mergeCandidates   = new MergeCandidatesNode();
    this.buildBookWorksets = new BuildBookWorksetsNode();
    this.preRunSetup       = new PreRunSetupNode();
    this.parkForInput      = new ParkForInputNode();
    this.respondToVisitor  = new RespondToVisitorNode();
    this.declineOffTopic   = new DeclineOffTopicNode();

    this.extractQuerySalvage          = new ExtractQuerySalvageNode();
    this.decideToolsSalvage           = new DecideToolsSalvageNode();
    this.classifyIntentSalvage        = new ClassifyIntentSalvageNode();
    this.rankCandidatesSalvage        = new RankCandidatesSalvageNode();
    this.composeResponseSalvage       = new ComposeResponseSalvageNode();
    this.composeEmptyResponseSalvage  = new ComposeEmptyResponseSalvageNode();
    this.composeMemoryResponseSalvage = new ComposeMemoryResponseSalvageNode();
  }

  /** Canonical factory: build the full shared node set from services. */
  static build(services: ArchivistServices): ArchivistNodes {
    return new ArchivistNodes(services);
  }
}
