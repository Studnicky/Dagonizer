export type VisualizerAnimationPolicyType = {
  readonly nodePulseInMs: number;
  readonly nodePulseOutMs: number;
  readonly nodeShake1Ms: number;
  readonly nodeShake2Ms: number;
  readonly nodeShake3Ms: number;
  readonly nodeShake4Ms: number;
  readonly edgeFlashInMs: number;
  readonly edgeFlashOutMs: number;
  readonly cameraFollowDebounceMs: number;
  readonly cameraFollowPanMs: number;
  readonly resetFadeMs: number;
  readonly fitCheckpointsMs: readonly number[];
  readonly fitSettleSnapshotMs: number;
  readonly fitAnimateMs: number;
  readonly simulationDecay: number;
  readonly transitionSnapMs: number;
};

/**
 * Canonical animation policy for Dagonizer visualizer surfaces.
 *
 * The policy does not force all renderers to animate identically.
 * It centralizes the semantic timing decisions that should stay aligned:
 *
 * - node activation emphasis;
 * - edge traversal emphasis;
 * - camera follow cadence;
 * - reset fade timing;
 * - bounded fit checkpoints for settling layouts;
 * - physics cooldown aggressiveness;
 * - transition snapping for interactions that must reflect runtime truth.
 */
export const DEFAULT_VISUALIZER_ANIMATION_POLICY: VisualizerAnimationPolicyType = {
  'nodePulseInMs':        280,
  'nodePulseOutMs':       360,
  'nodeShake1Ms':         70,
  'nodeShake2Ms':         70,
  'nodeShake3Ms':         60,
  'nodeShake4Ms':         60,
  'edgeFlashInMs':        220,
  'edgeFlashOutMs':       320,
  'cameraFollowDebounceMs': 200,
  'cameraFollowPanMs':    240,
  'resetFadeMs':          280,
  'fitCheckpointsMs':     [0, 250, 500, 750],
  'fitSettleSnapshotMs':  800,
  'fitAnimateMs':         200,
  'simulationDecay':      5000,
  'transitionSnapMs':     0,
};
