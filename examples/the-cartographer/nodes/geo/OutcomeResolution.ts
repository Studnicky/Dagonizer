import type { GeoResolution } from '../../entities/GeoResolution.ts';
import { GeoResolutionBuilder } from '../../entities/GeoResolution.ts';
import type { GeoLookupOutcomeType } from '../../errors/GeoLookupOutcome.ts';

export class OutcomeResolution {
  private constructor() {}

  static of(outcome: GeoLookupOutcomeType, source: GeoResolution['source'], weight: number): GeoResolution {
    const cand = outcome.candidate;
    const resolvedWeight = cand.resolved ? weight : 0;
    return GeoResolutionBuilder.from({
      'source':       source,
      'fallbackUsed': false,
      'timezone':     '',
      'country':      cand.country,
      'countryName':  cand.countryName,
      'locale':       '',
      'region':       cand.region,
      'locality':     cand.locality,
      'lat':          cand.lat,
      'lng':          cand.lng,
      'status':       cand.water ? 'water' : 'land',
      'weight':       resolvedWeight,
    });
  }
}
