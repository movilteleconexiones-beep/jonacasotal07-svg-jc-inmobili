import { getCountryOption } from './countries';

export interface AdministrativeOption {
  id: string;
  name: string;
}

export interface AdministrativeRegion extends AdministrativeOption {
  localities: AdministrativeOption[];
}

export interface AdministrativeCatalog {
  countryCode: string;
  countryName: string;
  regionLabel: string;
  localityLabel: string;
  regions: AdministrativeRegion[];
  attribution?: string;
}

type OpenAdminNode = {
  id?: string;
  name?: { local?: string; en?: string };
  code?: { id?: string };
  [key: string]: unknown;
};

type OpenAdminPayload = {
  _attribution?: string;
  data?: OpenAdminNode[];
};

const REPOSITORY_BY_COUNTRY: Record<string, string> = {
  AR: 'argentina-administrative-divisions',
  BO: 'bolivia-administrative-divisions',
  BR: 'brazil-administrative-divisions',
  CL: 'chile-administrative-divisions',
  CO: 'colombia-administrative-divisions',
  CR: 'costa-rica-administrative-divisions',
  DO: 'dominican-republic-administrative-divisions',
  EC: 'ecuador-administrative-divisions',
  SV: 'el-salvador-administrative-divisions',
  GT: 'guatemala-administrative-divisions',
  HN: 'honduras-administrative-divisions',
  MX: 'mexico-administrative-divisions',
  NI: 'nicaragua-administrative-divisions',
  PA: 'panama-administrative-divisions',
  PY: 'paraguay-administrative-divisions',
  PE: 'peru-administrative-divisions',
  UY: 'uruguay-administrative-divisions',
};

const ADMIN_LABELS: Record<string, { region: string; locality: string }> = {
  AR: { region: 'Provincia', locality: 'Municipio / localidad' },
  BO: { region: 'Departamento', locality: 'Municipio' },
  BR: { region: 'Estado', locality: 'Municipio' },
  CL: { region: 'Región', locality: 'Comuna' },
  CO: { region: 'Departamento', locality: 'Municipio / distrito' },
  CR: { region: 'Provincia', locality: 'Cantón / distrito' },
  DO: { region: 'Provincia', locality: 'Municipio' },
  EC: { region: 'Provincia', locality: 'Cantón / parroquia' },
  SV: { region: 'Departamento', locality: 'Municipio / distrito' },
  GT: { region: 'Departamento', locality: 'Municipio' },
  HN: { region: 'Departamento', locality: 'Municipio' },
  MX: { region: 'Estado', locality: 'Municipio / alcaldía' },
  NI: { region: 'Departamento / región', locality: 'Municipio' },
  PA: { region: 'Provincia / comarca', locality: 'Distrito / corregimiento' },
  PY: { region: 'Departamento', locality: 'Distrito' },
  PE: { region: 'Departamento', locality: 'Distrito' },
  UY: { region: 'Departamento', locality: 'Municipio / localidad' },
};

const cache = new Map<string, Promise<AdministrativeCatalog | null>>();

function localName(node: OpenAdminNode) {
  return node.name?.local || node.name?.en || node.id || 'Sin nombre';
}

function childArrays(node: OpenAdminNode): OpenAdminNode[][] {
  return Object.entries(node)
    .filter(([key, value]) =>
      !['name', 'code', 'ancestors', 'children_count', 'zip_codes', 'geo'].includes(key)
      && Array.isArray(value)
    )
    .map(([, value]) => value as OpenAdminNode[])
    .filter((items) => items.length > 0 && items.some((item) => typeof item === 'object'));
}

function collectLeafLocalities(node: OpenAdminNode, trail: string[] = []): AdministrativeOption[] {
  const children = childArrays(node).flat();

  if (children.length === 0) {
    const name = localName(node);
    return [{ id: node.id || name, name: [...trail, name].filter(Boolean).join(' · ') }];
  }

  const result: AdministrativeOption[] = [];
  for (const child of children) {
    const grandChildren = childArrays(child).flat();
    if (grandChildren.length === 0) {
      result.push({ id: child.id || localName(child), name: localName(child) });
    } else {
      const parentName = localName(child);
      for (const leaf of collectLeafLocalities(child)) {
        result.push({
          id: leaf.id,
          name: `${leaf.name} · ${parentName}`,
        });
      }
    }
  }

  return result;
}

export function administrativeLabels(countryCode: string) {
  return ADMIN_LABELS[countryCode] ?? { region: 'Estado / provincia / departamento', locality: 'Municipio / ciudad' };
}

export function loadAdministrativeCatalog(countryCode: string): Promise<AdministrativeCatalog | null> {
  const code = countryCode.toUpperCase();
  if (cache.has(code)) return cache.get(code)!;

  const request = (async () => {
    const repository = REPOSITORY_BY_COUNTRY[code];
    if (!repository) return null;

    try {
      const response = await fetch(
        `https://raw.githubusercontent.com/open-admin-data/${repository}/master/data/hierarchy.json`,
        { headers: { Accept: 'application/json' } },
      );

      if (!response.ok) return null;

      const payload = (await response.json()) as OpenAdminPayload;
      const topLevel = Array.isArray(payload.data) ? payload.data : [];
      if (topLevel.length === 0) return null;

      const labels = administrativeLabels(code);
      const country = getCountryOption(code);

      const regions = topLevel
        .map((region) => ({
          id: region.id || localName(region),
          name: localName(region),
          localities: collectLeafLocalities(region)
            .sort((a, b) => a.name.localeCompare(b.name, country.locale)),
        }))
        .sort((a, b) => a.name.localeCompare(b.name, country.locale));

      return {
        countryCode: code,
        countryName: country.name,
        regionLabel: labels.region,
        localityLabel: labels.locality,
        regions,
        attribution: payload._attribution,
      };
    } catch {
      return null;
    }
  })();

  cache.set(code, request);
  return request;
}
