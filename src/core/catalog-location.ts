import type { Property } from '../data/properties';
import { COLOMBIA_DIVIPOLA } from '../data/colombia-divipola';

export interface CatalogLocationSelection {
  region: string;
  locality: string;
}

type LocatedProperty = Pick<Property, 'municipality' | 'region' | 'city' | 'countryCode'>;
type SearchableProperty = LocatedProperty & Pick<Property, 'title' | 'neighborhood' | 'code' | 'architecturalSummary'>;

/** Match stored names independently of accents, case, punctuation or extra spaces. */
export function normalizeCatalogText(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es-CO').replace(/[^a-z0-9]+/g, ' ').trim();
}

function locationKey(value: string) {
  const key = normalizeCatalogText(value);
  return ['bogota', 'bogota d c', 'bogota dc'].includes(key) ? 'bogota' : key;
}

// Some legacy published properties have a city but no department. The DANE
// snapshot lets us infer a department ONLY for municipality names unique across
// Colombia. Homonymous municipalities fail closed rather than mislabel inventory.
const uniqueColombianRegionByMunicipality = new Map<string, string | null>();
for (const region of COLOMBIA_DIVIPOLA.regions) {
  for (const municipality of region.localities) {
    const key = locationKey(municipality.name);
    if (!key) continue;
    if (!uniqueColombianRegionByMunicipality.has(key)) {
      uniqueColombianRegionByMunicipality.set(key, region.name);
    } else if (uniqueColombianRegionByMunicipality.get(key) !== region.name) {
      uniqueColombianRegionByMunicipality.set(key, null);
    }
  }
}

function propertyLocation(property: LocatedProperty) {
  const [legacyCity = '', ...legacyRegion] = (property.municipality || '').split(',');
  const city = property.city?.trim() || legacyCity.trim();
  let region = property.region?.trim() || legacyRegion.join(',').trim();
  // Legacy public records store the capital as "Bogotá, D.C." rather than two fields.
  if (locationKey(city) === 'bogota' && (!region || locationKey(region) === 'd c')) region = 'Bogotá, D.C.';
  return { city, region };
}

export function matchesCatalogLocation(
  property: LocatedProperty,
  countryCode: string,
  selection: CatalogLocationSelection,
) {
  if (!selection.region && !selection.locality) return true;
  if (property.countryCode && property.countryCode.toUpperCase() !== countryCode.toUpperCase()) return false;
  const location = propertyLocation(property);
  const inferredRegion = countryCode.toUpperCase() === 'CO' && !location.region
    ? uniqueColombianRegionByMunicipality.get(locationKey(location.city)) ?? ''
    : '';
  const effectiveRegion = location.region || inferredRegion;
  return (!selection.region || locationKey(effectiveRegion) === locationKey(selection.region))
    && (!selection.locality || locationKey(location.city) === locationKey(selection.locality));
}

export function matchesCatalogSearch(property: SearchableProperty, query: string) {
  const key = normalizeCatalogText(query);
  if (!key) return true;
  return [property.title, property.neighborhood, property.code, property.architecturalSummary,
    property.municipality, property.region, property.city]
    .some(value => value && normalizeCatalogText(value).includes(key));
}
