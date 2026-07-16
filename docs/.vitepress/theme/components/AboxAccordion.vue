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

import { computed, ref } from 'vue';
import type { CanonicalEventVariant } from '../../../../examples/the-cartographer/entities/CanonicalEvent.ts';
import type { EnrichedShipment } from '../../../../examples/the-cartographer/entities/EnrichedShipment.ts';
import UiReadoutColumn from './ui/UiReadoutColumn.vue';
import UiReadoutGroup from './ui/UiReadoutGroup.vue';
import UiReadoutRow from './ui/UiReadoutRow.vue';

// ── Props ────────────────────────────────────────────────────────────────────
export interface AboxEntity {
  readonly id: string;
  readonly label: string;
  readonly before: CanonicalEventVariant | undefined;
  readonly after: EnrichedShipment;
}

// ── Before display ───────────────────────────────────────────────────────────

/** Flattened display-safe view of a CanonicalEventVariant for template access. */
interface BeforeDisplay {
  readonly shipmentId: string;
  readonly eventId: string;
  readonly eventType: string;
  readonly sourceId: string;
  readonly sourceFormat: string;
  readonly epochMs: number;
  readonly scanSeq: number;
  readonly latitude: number;
  readonly longitude: number;
  readonly rawTimestamp: string;
  readonly carrier: string;
  readonly status: string;
  readonly weight: number;
  readonly weightUnit: string;
  readonly recipientName: string;
  readonly recipientEmail: string;
  readonly recipientPhone: string;
  readonly lawfulBasis: string;
  readonly hasPii: boolean;
  readonly geoContinent: string;
  readonly geoCountry: string;
  readonly consentHandled: boolean | undefined;
}

function variantToDisplay(v: CanonicalEventVariant): BeforeDisplay {
  const sharedBody = v.body;
  let weight = 0;
  let weightUnit = 'kg';
  let recipientName = '';
  let recipientEmail = '';
  let recipientPhone = '';
  let lawfulBasis = '';
  let hasPii = false;
  if (v.eventType === 'facility-scan') {
    weight = v.body.weight;
    weightUnit = v.body.weightUnit;
    recipientName = v.body.recipientName;
    recipientEmail = v.body.recipientEmail;
    recipientPhone = v.body.recipientPhone;
    lawfulBasis = v.body.lawfulBasis;
    hasPii = true;
  } else if (v.eventType === 'delivery-confirmation') {
    recipientName = v.body.recipientName;
    recipientEmail = v.body.recipientEmail;
    recipientPhone = v.body.recipientPhone;
    lawfulBasis = v.body.lawfulBasis;
    hasPii = true;
  }
  return {
    'shipmentId':    v.shipmentId,
    'eventId':       v.eventId,
    'eventType':     v.eventType,
    'sourceId':      v.sourceId,
    'sourceFormat':  v.sourceFormat,
    'epochMs':       v.epochMs,
    'scanSeq':       sharedBody.scanSeq,
    'latitude':      sharedBody.latitude,
    'longitude':     sharedBody.longitude,
    'rawTimestamp':  sharedBody.rawTimestamp,
    'carrier':       sharedBody.carrier,
    'status':        sharedBody.status,
    weight,
    weightUnit,
    recipientName,
    recipientEmail,
    recipientPhone,
    lawfulBasis,
    hasPii,
    'geoContinent':     v.geo?.continent ?? '',
    'geoCountry':       v.geo?.country ?? '',
    'consentHandled':   v.consentHandled,
  };
}

/** Derived entity list: before is pre-computed to a flat display object so
 *  the template never accesses union members directly. */
interface DerivedEntity {
  readonly id: string;
  readonly label: string;
  readonly beforeDisplay: BeforeDisplay | null;
  readonly after: EnrichedShipment;
}

interface ReadoutRowEntry {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly mono?: boolean;
  readonly valueClass?: string;
}

interface ReadoutGroupEntry {
  readonly key: string;
  readonly title: string;
  readonly rows: readonly ReadoutRowEntry[];
}

const props = defineProps<{
  entities: AboxEntity[];
}>();

const derivedEntities = computed<DerivedEntity[]>(() =>
  props.entities.map((e) => ({
    'id':            e.id,
    'label':         e.label,
    'beforeDisplay': e.before !== undefined ? variantToDisplay(e.before) : null,
    'after':         e.after,
  })),
);

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

function beforeGroups(before: BeforeDisplay): readonly ReadoutGroupEntry[] {
  return [
    {
      'key': 'identity',
      'title': 'identity',
      'rows': [
        { 'key': 'shipmentId', 'label': 'shipmentId', 'value': before.shipmentId, 'mono': true },
        { 'key': 'eventId', 'label': 'eventId', 'value': before.eventId, 'mono': true },
        { 'key': 'eventType', 'label': 'eventType', 'value': before.eventType, 'mono': true },
        { 'key': 'source', 'label': 'source', 'value': `${before.sourceId} (${before.sourceFormat})`, 'mono': true },
      ],
    },
    {
      'key': 'timestamp',
      'title': 'timestamp',
      'rows': [
        { 'key': 'epochMs', 'label': 'epochMs', 'value': fmtEpoch(before.epochMs), 'mono': true },
        { 'key': 'raw', 'label': 'raw', 'value': before.rawTimestamp || '—', 'mono': true },
      ],
    },
    {
      'key': 'location',
      'title': 'location (raw)',
      'rows': [
        { 'key': 'latLng', 'label': 'lat/lng', 'value': fmtLatLng(before.latitude, before.longitude), 'mono': true },
        { 'key': 'geo', 'label': 'geo pre-resolved', 'value': before.geoContinent !== '' ? `${before.geoContinent} / ${before.geoCountry}` : 'no', 'mono': true },
      ],
    },
    {
      'key': 'parcel',
      'title': 'parcel',
      'rows': [
        { 'key': 'carrier', 'label': 'carrier', 'value': before.carrier || '—', 'mono': true },
        { 'key': 'weight', 'label': 'weight', 'value': before.weight > 0 ? fmtWeight(before.weight, before.weightUnit) : '—', 'mono': true },
        { 'key': 'status', 'label': 'status', 'value': before.status || '—', 'mono': true },
      ],
    },
    {
      'key': 'pii',
      'title': 'pii',
      'rows': [
        { 'key': 'name', 'label': 'name', 'value': before.recipientName || '—', 'mono': true },
        { 'key': 'email', 'label': 'email', 'value': before.recipientEmail || '—', 'mono': true },
        { 'key': 'phone', 'label': 'phone', 'value': before.recipientPhone || '—', 'mono': true },
        { 'key': 'lawfulBasis', 'label': 'lawful basis', 'value': before.lawfulBasis || '—', 'mono': true },
        { 'key': 'consentHandled', 'label': 'consent handled', 'value': before.consentHandled !== undefined ? String(before.consentHandled) : 'not set', 'mono': true },
      ],
    },
  ];
}

function afterGroups(after: EnrichedShipment): readonly ReadoutGroupEntry[] {
  return [
    {
      'key': 'identity',
      'title': 'identity',
      'rows': [
        { 'key': 'shipmentId', 'label': 'shipmentId', 'value': after.shipmentId, 'mono': true, 'valueClass': 'cr-brand' },
        { 'key': 'scanSeq', 'label': 'scanSeq', 'value': String(after.scanSeq), 'mono': true, 'valueClass': 'cr-brand' },
        { 'key': 'status', 'label': 'status', 'value': after.status, 'mono': true, 'valueClass': 'cr-brand' },
      ],
    },
    {
      'key': 'timestamp',
      'title': 'timestamp (normalized)',
      'rows': [
        { 'key': 'epochMs', 'label': 'epochMs', 'value': fmtEpoch(after.epochMs), 'mono': true, 'valueClass': 'cr-brand' },
        { 'key': 'localIso', 'label': 'localIso', 'value': after.localIso || '—', 'mono': true, 'valueClass': 'cr-brand' },
        { 'key': 'utcOffset', 'label': 'utcOffset', 'value': after.utcOffset || 'UTC', 'mono': true, 'valueClass': 'cr-brand' },
        { 'key': 'timezone', 'label': 'timezone', 'value': after.timezone, 'mono': true, 'valueClass': 'cr-brand' },
      ],
    },
    {
      'key': 'location',
      'title': 'location (resolved)',
      'rows': [
        { 'key': 'coords', 'label': 'coords', 'value': `${fmtLatLng(after.lat, after.lng)}${after.coordsCoarsened ? ' (coarsened)' : ''}`, 'mono': true, 'valueClass': 'cr-brand' },
        { 'key': 'continent', 'label': 'continent', 'value': after.continent, 'mono': true, 'valueClass': 'cr-brand' },
        { 'key': 'country', 'label': 'country', 'value': after.country, 'mono': true, 'valueClass': 'cr-brand' },
        { 'key': 'region', 'label': 'region', 'value': after.region || '—', 'mono': true, 'valueClass': 'cr-brand' },
        { 'key': 'hub', 'label': 'hub', 'value': after.hub || '—', 'mono': true, 'valueClass': 'cr-brand' },
        { 'key': 'jurisdiction', 'label': 'jurisdiction', 'value': after.jurisdiction, 'mono': true, 'valueClass': 'cr-brand' },
      ],
    },
    {
      'key': 'classification',
      'title': 'classification',
      'rows': [
        { 'key': 'serviceTier', 'label': 'serviceTier', 'value': after.serviceTier, 'mono': true, 'valueClass': 'cr-brand' },
        { 'key': 'sizeTier', 'label': 'sizeTier', 'value': after.sizeTier, 'mono': true, 'valueClass': 'cr-brand' },
      ],
    },
    {
      'key': 'pricing',
      'title': 'pricing / shipping',
      'rows': [
        { 'key': 'subtotal', 'label': 'subtotal', 'value': usdFromMinor(after.subtotalUsdMinor), 'mono': true, 'valueClass': 'cr-brand' },
        { 'key': 'shipping', 'label': 'shipping', 'value': usdFromMinor(after.shippingUsdMinor), 'mono': true, 'valueClass': 'cr-brand' },
        { 'key': 'distance', 'label': 'distance', 'value': `${after.distanceKm.toFixed(1)} km`, 'mono': true, 'valueClass': 'cr-brand' },
        { 'key': 'transitHours', 'label': 'transitHours', 'value': `${after.transitHours.toFixed(1)}h`, 'mono': true, 'valueClass': 'cr-brand' },
      ],
    },
    {
      'key': 'pii',
      'title': 'pii / redaction',
      'rows': [
        { 'key': 'redactionApplied', 'label': 'redactionApplied', 'value': String(after.redactionApplied), 'mono': true, 'valueClass': after.redactionApplied ? 'cr-brand3' : 'cr-muted' },
        { 'key': 'name', 'label': 'name', 'value': after.redactedSample.recipientName || '[redacted]', 'mono': true, 'valueClass': 'cr-brand' },
        { 'key': 'email', 'label': 'email', 'value': after.redactedSample.recipientEmail || '[redacted]', 'mono': true, 'valueClass': 'cr-brand' },
        { 'key': 'phone', 'label': 'phone', 'value': after.redactedSample.recipientPhone || '[redacted]', 'mono': true, 'valueClass': 'cr-brand' },
        { 'key': 'consentStatus', 'label': 'consentStatus', 'value': after.consentStatus, 'mono': true, 'valueClass': 'cr-brand' },
        { 'key': 'coordsCoarsened', 'label': 'coordsCoarsened', 'value': String(after.coordsCoarsened), 'mono': true, 'valueClass': after.coordsCoarsened ? 'cr-brand3' : 'cr-muted' },
      ],
    },
    {
      'key': 'routing',
      'title': 'routing',
      'rows': [
        { 'key': 'path', 'label': 'path', 'value': after.routing.path, 'mono': true, 'valueClass': 'cr-brand' },
        { 'key': 'geoResolve', 'label': 'geo-resolve', 'value': after.routing.geoLookupRun ? 'ran' : 'skipped', 'valueClass': after.routing.geoLookupRun ? 'cr-tag--ran' : 'cr-tag--skipped' },
        { 'key': 'redaction', 'label': 'redaction', 'value': after.routing.redactionRun ? 'ran' : 'skipped', 'valueClass': after.routing.redactionRun ? 'cr-tag--ran' : 'cr-tag--skipped' },
        { 'key': 'pricing', 'label': 'pricing', 'value': after.routing.pricingRun ? 'ran' : 'skipped', 'valueClass': after.routing.pricingRun ? 'cr-tag--ran' : 'cr-tag--skipped' },
        { 'key': 'eta', 'label': 'eta', 'value': after.routing.etaRun ? 'ran' : 'skipped', 'valueClass': after.routing.etaRun ? 'cr-tag--ran' : 'cr-tag--skipped' },
      ],
    },
  ];
}
</script>

<template>
  <div class="abox-accordion">
    <div
      v-for="entity in derivedEntities"
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

        <!-- Two-column before→after layout -->
        <div class="abox-cols">

          <!-- BEFORE column -->
          <UiReadoutColumn title="before" muted>
            <template v-if="entity.beforeDisplay !== null">
              <UiReadoutGroup
                v-for="group in beforeGroups(entity.beforeDisplay)"
                :key="group.key"
                :title="group.title"
              >
                <UiReadoutRow
                  v-for="row in group.rows"
                  :key="row.key"
                  :label="row.label"
                  :mono="row.mono === true"
                >
                  <span :class="row.valueClass">{{ row.value }}</span>
                </UiReadoutRow>
              </UiReadoutGroup>
            </template>
            <template v-else>
              <div class="abox-no-before">pre-stream event not matched</div>
            </template>
          </UiReadoutColumn>

          <!-- AFTER column -->
          <UiReadoutColumn title="after" tone="brand">
            <UiReadoutGroup
              v-for="group in afterGroups(entity.after)"
              :key="group.key"
              :title="group.title"
            >
              <UiReadoutRow
                v-for="row in group.rows"
                :key="row.key"
                :label="row.label"
                :mono="row.mono === true"
              >
                <span :class="row.valueClass">{{ row.value }}</span>
              </UiReadoutRow>
            </UiReadoutGroup>
          </UiReadoutColumn>

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
