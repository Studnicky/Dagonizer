<script setup lang="ts">
/**
 * AboxAccordion: displays a list of ABox entities (paired pre/post stream payloads)
 * as a classic one-open-at-a-time accordion.
 *
 * Each row header shows a concise label; expanding it reveals a two-column
 * before→after layout of the meaningful fields, plus download and open-in-new-tab
 * buttons for each raw payload.
 *
 * Browser-only: download / open buttons use Blob + object URLs and are only
 * rendered after mount (no SSR hazard). `import.meta.env.SSR` guards the
 * Blob operations inside handlers so Vite SSR pre-render stays clean.
 */

import { ref } from 'vue';
import type { CanonicalEvent } from '../../../../examples/the-cartographer/entities/CanonicalEvent.ts';
import type { EnrichedShipment } from '../../../../examples/the-cartographer/entities/EnrichedShipment.ts';

// ── Props ────────────────────────────────────────────────────────────────────
export interface AboxEntity {
  readonly id: string;
  readonly label: string;
  readonly before: CanonicalEvent | undefined;
  readonly after: EnrichedShipment;
}

const props = defineProps<{
  entities: AboxEntity[];
}>();

// ── One-open-at-a-time accordion ─────────────────────────────────────────────
const openId = ref<string | null>(null);

function toggle(id: string): void {
  openId.value = openId.value === id ? null : id;
}

// ── Formatting helpers ───────────────────────────────────────────────────────
function usdFromMinor(minor: number): string {
  return `$${(minor / 100).toFixed(2)}`;
}

function fmtEpoch(ms: number): string {
  if (ms === 0) return '—';
  return new Date(ms).toISOString().replace('T', ' ').replace('Z', ' UTC');
}

function fmtLatLng(lat: number, lng: number): string {
  return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}

function fmtWeight(weight: number, unit: string): string {
  if (unit === 'g') return `${weight}g`;
  if (unit === 'kg') return `${weight}kg`;
  if (unit === 'lb') return `${weight}lb`;
  if (unit === 'oz') return `${weight}oz`;
  return `${weight} ${unit}`;
}

// ── Blob + object URL helpers (browser-only) ─────────────────────────────────
function makeBlob(payload: unknown): Blob {
  return new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
}

function downloadPayload(payload: unknown, filename: string): void {
  if (import.meta.env.SSR) return;
  const blob = makeBlob(payload);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revoke to allow the click to register
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function openPayload(payload: unknown): void {
  if (import.meta.env.SSR) return;
  const blob = makeBlob(payload);
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank');
  // Revoke after the new tab has loaded (best-effort)
  if (win !== null) {
    win.addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
  } else {
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
}

function beforeFilename(entity: AboxEntity): string {
  const scanPart = entity.before !== undefined
    ? `scan${entity.before.body.scanSeq}`
    : `scan${entity.after.scanSeq}`;
  return `${entity.after.shipmentId}-${scanPart}-before.json`;
}

function afterFilename(entity: AboxEntity): string {
  return `${entity.after.shipmentId}-scan${entity.after.scanSeq}-after.json`;
}
</script>

<template>
  <div class="abox-accordion">
    <div
      v-for="entity in props.entities"
      :key="entity.id"
      class="abox-item"
      :class="{ 'abox-item--open': openId === entity.id }"
    >
      <!-- Collapsed row header -->
      <button
        type="button"
        class="abox-trigger"
        :aria-expanded="openId === entity.id"
        @click="toggle(entity.id)"
      >
        <span class="abox-chevron" aria-hidden="true">{{ openId === entity.id ? '▾' : '▸' }}</span>
        <span class="abox-label mono">{{ entity.label }}</span>
        <span
          v-if="entity.after.redactionApplied"
          class="abox-badge abox-badge--redacted"
          title="GDPR redaction applied"
        >redacted</span>
        <span
          v-if="entity.after.exception"
          class="abox-badge abox-badge--exception"
          title="Exception event"
        >exception</span>
        <span
          class="abox-badge"
          :class="entity.after.onTime ? 'abox-badge--ok' : 'abox-badge--late'"
        >{{ entity.after.onTime ? 'on-time' : `${entity.after.delayHours.toFixed(1)}h late` }}</span>
      </button>

      <!-- Expanded content -->
      <div v-if="openId === entity.id" class="abox-body">

        <!-- Payload action bar -->
        <div class="abox-payload-bar">
          <span class="abox-payload-label">Before (CanonicalEvent)</span>
          <div class="abox-payload-actions">
            <button
              type="button"
              class="abox-btn abox-btn--sm"
              :disabled="entity.before === undefined"
              @click="entity.before !== undefined && downloadPayload(entity.before, beforeFilename(entity))"
            >download</button>
            <button
              type="button"
              class="abox-btn abox-btn--sm"
              :disabled="entity.before === undefined"
              @click="entity.before !== undefined && openPayload(entity.before)"
            >open</button>
          </div>
          <span class="abox-payload-label">After (EnrichedShipment)</span>
          <div class="abox-payload-actions">
            <button
              type="button"
              class="abox-btn abox-btn--sm"
              @click="downloadPayload(entity.after, afterFilename(entity))"
            >download</button>
            <button
              type="button"
              class="abox-btn abox-btn--sm"
              @click="openPayload(entity.after)"
            >open</button>
          </div>
        </div>

        <!-- Two-column before→after layout -->
        <div class="abox-cols">

          <!-- BEFORE column -->
          <div class="abox-col abox-col--before">
            <div class="abox-col-head">before</div>
            <template v-if="entity.before !== undefined">
              <div class="abox-field-group">
                <div class="abox-field-head">identity</div>
                <div class="abox-field-row">
                  <span class="abox-field-key">shipmentId</span>
                  <span class="abox-field-val mono">{{ entity.before.shipmentId }}</span>
                </div>
                <div class="abox-field-row">
                  <span class="abox-field-key">eventId</span>
                  <span class="abox-field-val mono">{{ entity.before.eventId }}</span>
                </div>
                <div class="abox-field-row">
                  <span class="abox-field-key">kind</span>
                  <span class="abox-field-val mono">{{ entity.before.kind }}</span>
                </div>
                <div class="abox-field-row">
                  <span class="abox-field-key">source</span>
                  <span class="abox-field-val mono">{{ entity.before.sourceId }} ({{ entity.before.sourceFormat }})</span>
                </div>
              </div>
              <div class="abox-field-group">
                <div class="abox-field-head">timestamp</div>
                <div class="abox-field-row">
                  <span class="abox-field-key">epochMs</span>
                  <span class="abox-field-val mono">{{ fmtEpoch(entity.before.epochMs) }}</span>
                </div>
                <div class="abox-field-row">
                  <span class="abox-field-key">raw</span>
                  <span class="abox-field-val mono">{{ entity.before.body.rawTimestamp || '—' }}</span>
                </div>
              </div>
              <div class="abox-field-group">
                <div class="abox-field-head">location (raw)</div>
                <div class="abox-field-row">
                  <span class="abox-field-key">lat/lng</span>
                  <span class="abox-field-val mono">{{ fmtLatLng(entity.before.body.latitude, entity.before.body.longitude) }}</span>
                </div>
                <div class="abox-field-row">
                  <span class="abox-field-key">geo pre-resolved</span>
                  <span class="abox-field-val mono">
                    <template v-if="entity.before.geo !== undefined">{{ entity.before.geo.continent }} / {{ entity.before.geo.country }}</template>
                    <template v-else>no</template>
                  </span>
                </div>
              </div>
              <div class="abox-field-group">
                <div class="abox-field-head">parcel</div>
                <div class="abox-field-row">
                  <span class="abox-field-key">carrier</span>
                  <span class="abox-field-val mono">{{ entity.before.body.carrier || '—' }}</span>
                </div>
                <div class="abox-field-row">
                  <span class="abox-field-key">weight</span>
                  <span class="abox-field-val mono">{{ fmtWeight(entity.before.body.weight, entity.before.body.weightUnit) }}</span>
                </div>
                <div class="abox-field-row">
                  <span class="abox-field-key">status</span>
                  <span class="abox-field-val mono">{{ entity.before.body.status || '—' }}</span>
                </div>
              </div>
              <div class="abox-field-group">
                <div class="abox-field-head">pii</div>
                <div class="abox-field-row">
                  <span class="abox-field-key">name</span>
                  <span class="abox-field-val mono">{{ entity.before.body.recipientName || '—' }}</span>
                </div>
                <div class="abox-field-row">
                  <span class="abox-field-key">email</span>
                  <span class="abox-field-val mono">{{ entity.before.body.recipientEmail || '—' }}</span>
                </div>
                <div class="abox-field-row">
                  <span class="abox-field-key">phone</span>
                  <span class="abox-field-val mono">{{ entity.before.body.recipientPhone || '—' }}</span>
                </div>
                <div class="abox-field-row">
                  <span class="abox-field-key">lawful basis</span>
                  <span class="abox-field-val mono">{{ entity.before.body.lawfulBasis }}</span>
                </div>
                <div class="abox-field-row">
                  <span class="abox-field-key">consent handled</span>
                  <span class="abox-field-val mono">{{ entity.before.consentHandled !== undefined ? String(entity.before.consentHandled) : 'not set' }}</span>
                </div>
              </div>
            </template>
            <template v-else>
              <div class="abox-no-before">pre-stream event not matched</div>
            </template>
          </div>

          <!-- AFTER column -->
          <div class="abox-col abox-col--after">
            <div class="abox-col-head">after</div>
            <div class="abox-field-group">
              <div class="abox-field-head">identity</div>
              <div class="abox-field-row">
                <span class="abox-field-key">shipmentId</span>
                <span class="abox-field-val mono cr-brand">{{ entity.after.shipmentId }}</span>
              </div>
              <div class="abox-field-row">
                <span class="abox-field-key">scanSeq</span>
                <span class="abox-field-val mono cr-brand">{{ entity.after.scanSeq }}</span>
              </div>
              <div class="abox-field-row">
                <span class="abox-field-key">eventType</span>
                <span class="abox-field-val mono cr-brand">{{ entity.after.eventType }}</span>
              </div>
            </div>
            <div class="abox-field-group">
              <div class="abox-field-head">timestamp (normalized)</div>
              <div class="abox-field-row">
                <span class="abox-field-key">epochMs</span>
                <span class="abox-field-val mono cr-brand">{{ fmtEpoch(entity.after.epochMs) }}</span>
              </div>
              <div class="abox-field-row">
                <span class="abox-field-key">localIso</span>
                <span class="abox-field-val mono cr-brand">{{ entity.after.localIso || '—' }}</span>
              </div>
              <div class="abox-field-row">
                <span class="abox-field-key">utcOffset</span>
                <span class="abox-field-val mono cr-brand">{{ entity.after.utcOffset || 'UTC' }}</span>
              </div>
              <div class="abox-field-row">
                <span class="abox-field-key">timezone</span>
                <span class="abox-field-val mono cr-brand">{{ entity.after.timezone }}</span>
              </div>
            </div>
            <div class="abox-field-group">
              <div class="abox-field-head">location (resolved)</div>
              <div class="abox-field-row">
                <span class="abox-field-key">coords</span>
                <span class="abox-field-val mono cr-brand">{{ fmtLatLng(entity.after.lat, entity.after.lng) }}<template v-if="entity.after.coordsCoarsened"> (coarsened)</template></span>
              </div>
              <div class="abox-field-row">
                <span class="abox-field-key">continent</span>
                <span class="abox-field-val mono cr-brand">{{ entity.after.continent }}</span>
              </div>
              <div class="abox-field-row">
                <span class="abox-field-key">country</span>
                <span class="abox-field-val mono cr-brand">{{ entity.after.country }}</span>
              </div>
              <div class="abox-field-row">
                <span class="abox-field-key">region</span>
                <span class="abox-field-val mono cr-brand">{{ entity.after.region || '—' }}</span>
              </div>
              <div class="abox-field-row">
                <span class="abox-field-key">hub</span>
                <span class="abox-field-val mono cr-brand">{{ entity.after.hub || '—' }}</span>
              </div>
              <div class="abox-field-row">
                <span class="abox-field-key">jurisdiction</span>
                <span class="abox-field-val mono cr-brand">{{ entity.after.jurisdiction }}</span>
              </div>
            </div>
            <div class="abox-field-group">
              <div class="abox-field-head">classification</div>
              <div class="abox-field-row">
                <span class="abox-field-key">serviceTier</span>
                <span class="abox-field-val mono cr-brand">{{ entity.after.serviceTier }}</span>
              </div>
              <div class="abox-field-row">
                <span class="abox-field-key">sizeTier</span>
                <span class="abox-field-val mono cr-brand">{{ entity.after.sizeTier }}</span>
              </div>
            </div>
            <div class="abox-field-group">
              <div class="abox-field-head">pricing / shipping</div>
              <div class="abox-field-row">
                <span class="abox-field-key">subtotal</span>
                <span class="abox-field-val mono cr-brand">{{ usdFromMinor(entity.after.subtotalUsdMinor) }}</span>
              </div>
              <div class="abox-field-row">
                <span class="abox-field-key">shipping</span>
                <span class="abox-field-val mono cr-brand">{{ usdFromMinor(entity.after.shippingUsdMinor) }}</span>
              </div>
              <div class="abox-field-row">
                <span class="abox-field-key">distance</span>
                <span class="abox-field-val mono cr-brand">{{ entity.after.distanceKm.toFixed(1) }} km</span>
              </div>
              <div class="abox-field-row">
                <span class="abox-field-key">transitHours</span>
                <span class="abox-field-val mono cr-brand">{{ entity.after.transitHours.toFixed(1) }}h</span>
              </div>
            </div>
            <div class="abox-field-group">
              <div class="abox-field-head">pii / redaction</div>
              <div class="abox-field-row">
                <span class="abox-field-key">redactionApplied</span>
                <span class="abox-field-val mono" :class="entity.after.redactionApplied ? 'cr-brand3' : 'cr-muted'">{{ entity.after.redactionApplied }}</span>
              </div>
              <div class="abox-field-row">
                <span class="abox-field-key">name</span>
                <span class="abox-field-val mono cr-brand">{{ entity.after.redactedSample.recipientName || '[redacted]' }}</span>
              </div>
              <div class="abox-field-row">
                <span class="abox-field-key">email</span>
                <span class="abox-field-val mono cr-brand">{{ entity.after.redactedSample.recipientEmail || '[redacted]' }}</span>
              </div>
              <div class="abox-field-row">
                <span class="abox-field-key">phone</span>
                <span class="abox-field-val mono cr-brand">{{ entity.after.redactedSample.recipientPhone || '[redacted]' }}</span>
              </div>
              <div class="abox-field-row">
                <span class="abox-field-key">consentStatus</span>
                <span class="abox-field-val mono cr-brand">{{ entity.after.consentStatus }}</span>
              </div>
              <div class="abox-field-row">
                <span class="abox-field-key">coordsCoarsened</span>
                <span class="abox-field-val mono" :class="entity.after.coordsCoarsened ? 'cr-brand3' : 'cr-muted'">{{ entity.after.coordsCoarsened }}</span>
              </div>
            </div>
            <div class="abox-field-group">
              <div class="abox-field-head">routing</div>
              <div class="abox-field-row">
                <span class="abox-field-key">path</span>
                <span class="abox-field-val mono cr-brand">{{ entity.after.routing.path }}</span>
              </div>
              <div class="abox-field-row">
                <span class="abox-field-key">geo-resolve</span>
                <span class="abox-field-val" :class="entity.after.routing.geoLookupRun ? 'cr-tag--ran' : 'cr-tag--skipped'">{{ entity.after.routing.geoLookupRun ? 'ran' : 'skipped' }}</span>
              </div>
              <div class="abox-field-row">
                <span class="abox-field-key">redaction</span>
                <span class="abox-field-val" :class="entity.after.routing.redactionRun ? 'cr-tag--ran' : 'cr-tag--skipped'">{{ entity.after.routing.redactionRun ? 'ran' : 'skipped' }}</span>
              </div>
              <div class="abox-field-row">
                <span class="abox-field-key">pricing</span>
                <span class="abox-field-val" :class="entity.after.routing.pricingRun ? 'cr-tag--ran' : 'cr-tag--skipped'">{{ entity.after.routing.pricingRun ? 'ran' : 'skipped' }}</span>
              </div>
              <div class="abox-field-row">
                <span class="abox-field-key">eta</span>
                <span class="abox-field-val" :class="entity.after.routing.etaRun ? 'cr-tag--ran' : 'cr-tag--skipped'">{{ entity.after.routing.etaRun ? 'ran' : 'skipped' }}</span>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ── Accordion container ─────────────────────────────────────────────────── */
.abox-accordion {
  display: flex;
  flex-direction: column;
  gap: 0;
  width: 100%;
}

/* ── Item shell ──────────────────────────────────────────────────────────── */
.abox-item {
  border-bottom: 1px solid var(--vp-c-divider);
}

.abox-item:last-child {
  border-bottom: none;
}

/* ── Trigger row ─────────────────────────────────────────────────────────── */
.abox-trigger {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  width: 100%;
  padding: 0.45rem 0.6rem;
  background: transparent;
  border: none;
  cursor: pointer;
  text-align: left;
  color: var(--vp-c-text-1);
  transition: background 0.1s ease;
  flex-wrap: nowrap;
  overflow: hidden;
}

.abox-trigger:hover {
  background: var(--vp-c-bg-elv);
}

.abox-item--open .abox-trigger {
  background: var(--vp-c-bg-elv);
  border-bottom: 1px solid var(--vp-c-divider);
}

/* ── Chevron ─────────────────────────────────────────────────────────────── */
.abox-chevron {
  flex-shrink: 0;
  font-size: 0.75rem;
  color: var(--vp-c-text-3);
  width: 14px;
  text-align: center;
}

/* ── Label ───────────────────────────────────────────────────────────────── */
.abox-label {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 0.78rem;
  color: var(--vp-c-text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── Header badges ───────────────────────────────────────────────────────── */
.abox-badge {
  flex-shrink: 0;
  padding: 0.1rem 0.35rem;
  border-radius: 3px;
  font-size: 0.63rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.abox-badge--ok {
  background: rgba(34, 232, 255, 0.15);
  color: var(--dagonizer-brand);
}

.abox-badge--late {
  background: rgba(212, 166, 73, 0.15);
  color: var(--dagonizer-brand3);
}

.abox-badge--exception {
  background: rgba(180, 70, 70, 0.15);
  color: #e06060;
}

.abox-badge--redacted {
  background: rgba(212, 166, 73, 0.12);
  color: var(--dagonizer-brand3);
}

/* ── Expanded body ────────────────────────────────────────────────────────── */
.abox-body {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding: 0.65rem 0.6rem 0.85rem;
  background: var(--vp-c-bg-alt);
}

/* ── Payload action bar ──────────────────────────────────────────────────── */
.abox-payload-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
  padding: 0.35rem 0.55rem;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  border-radius: 5px;
  font-size: 0.72rem;
}

.abox-payload-label {
  font-size: 0.67rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--vp-c-text-3);
  white-space: nowrap;
}

.abox-payload-actions {
  display: flex;
  gap: 0.3rem;
}

/* ── Small action buttons ────────────────────────────────────────────────── */
.abox-btn {
  display: inline-flex;
  align-items: center;
  padding: 0.2rem 0.55rem;
  border-radius: 4px;
  font-family: var(--vp-font-family-mono);
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  cursor: pointer;
  border: 1px solid var(--vp-c-divider);
  background: transparent;
  color: var(--vp-c-text-2);
  transition: border-color 0.1s ease, color 0.1s ease, background 0.1s ease;
}

.abox-btn:hover:not(:disabled) {
  border-color: var(--dagonizer-brand);
  color: var(--dagonizer-brand);
}

.abox-btn:disabled {
  opacity: 0.35;
  cursor: default;
}

/* ── Two-column layout ───────────────────────────────────────────────────── */
.abox-cols {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.6rem;
  align-items: start;
}

@media (max-width: 600px) {
  .abox-cols {
    grid-template-columns: 1fr;
  }
}

/* ── Column ──────────────────────────────────────────────────────────────── */
.abox-col {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.55rem 0.65rem;
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  background: var(--vp-c-bg);
  min-width: 0;
}

.abox-col--before {
  border-left: 2px solid var(--vp-c-text-3);
  opacity: 0.85;
}

.abox-col--after {
  border-left: 2px solid var(--dagonizer-brand);
}

.abox-col-head {
  font-size: 0.63rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--vp-c-text-3);
  padding-bottom: 0.3rem;
  border-bottom: 1px solid var(--vp-c-divider);
  margin-bottom: 0.1rem;
}

.abox-col--after .abox-col-head {
  color: var(--dagonizer-brand);
}

/* ── Field groups ────────────────────────────────────────────────────────── */
.abox-field-group {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.abox-field-head {
  font-size: 0.6rem;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--vp-c-text-3);
  padding: 0.2rem 0 0.1rem;
  margin-top: 0.25rem;
  border-bottom: 1px solid var(--vp-c-divider);
  margin-bottom: 0.15rem;
}

.abox-field-row {
  display: flex;
  gap: 0.4rem;
  align-items: baseline;
  padding: 0.1rem 0;
  font-size: 0.74rem;
  border-bottom: 1px solid transparent;
  min-width: 0;
  flex-wrap: nowrap;
}

.abox-field-key {
  flex-shrink: 0;
  width: 100px;
  font-size: 0.65rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--vp-c-text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.abox-field-val {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 0.74rem;
  color: var(--vp-c-text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── "No match" state ────────────────────────────────────────────────────── */
.abox-no-before {
  font-size: 0.78rem;
  color: var(--vp-c-text-3);
  padding: 0.5rem 0;
  font-style: italic;
}

/* ── Colour tokens from CartographerRunner ───────────────────────────────── */
.mono {
  font-family: var(--vp-font-family-mono);
}

.cr-brand {
  color: var(--dagonizer-brand);
}

.cr-brand3 {
  color: var(--dagonizer-brand3);
}

.cr-muted {
  color: var(--vp-c-text-3);
}

.cr-tag--ran {
  color: var(--dagonizer-brand);
  font-weight: 600;
  font-family: var(--vp-font-family-mono);
  font-size: 0.74rem;
}

.cr-tag--skipped {
  color: var(--vp-c-text-3);
  font-family: var(--vp-font-family-mono);
  font-size: 0.74rem;
}
</style>
