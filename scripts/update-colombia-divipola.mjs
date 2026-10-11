import { readFile, writeFile } from 'node:fs/promises';

const source = 'https://www.datos.gov.co/Mapas-Nacionales/DIVIPOLA-C-digos-municipios/gdxc-w37w';
const rowsUrl = 'https://www.datos.gov.co/resource/gdxc-w37w.json?$limit=5000';
const metadataUrl = 'https://www.datos.gov.co/api/views/gdxc-w37w.json';
const collator = new Intl.Collator('es-CO');

async function readJson(url, localPath) {
  if (localPath) return JSON.parse(await readFile(localPath, 'utf8'));
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`DANE catalog request failed: ${response.status}`);
  return response.json();
}

function displayName(value) {
  const connectors = new Set(['de', 'del', 'la', 'las', 'los', 'y']);
  return value.toLocaleLowerCase('es-CO').split(' ').map((word, index) => {
    if (word === 'd.c.') return 'D.C.';
    if (index > 0 && connectors.has(word)) return word;
    return word.charAt(0).toLocaleUpperCase('es-CO') + word.slice(1);
  }).join(' ');
}

const [rows, metadata] = await Promise.all([
  readJson(rowsUrl, process.argv[2]),
  readJson(metadataUrl, process.argv[3]),
]);
if (!Array.isArray(rows) || rows.length < 1100 || rows.length >= 5000
    || !metadata.attribution?.includes('DANE') || metadata.licenseId !== 'CC_40_BY_SA') {
  throw new Error('Unexpected source, license or incomplete DIVIPOLA catalog.');
}
const regions = new Map();
const seen = new Set();
for (const row of rows) {
  if (!/^\d{2}$/.test(row.cod_dpto) || !/^\d{5}$/.test(row.cod_mpio)
      || !row.cod_mpio.startsWith(row.cod_dpto) || seen.has(row.cod_mpio)
      || typeof row.dpto !== 'string' || !row.dpto.trim()
      || typeof row.nom_mpio !== 'string' || !row.nom_mpio.trim()
      || !['Municipio', 'Isla', 'Área no municipalizada'].includes(row.tipo_municipio)) {
    throw new Error('Invalid or duplicate DIVIPOLA location.');
  }
  seen.add(row.cod_mpio);
  const name = displayName(row.dpto);
  if (!regions.has(row.cod_dpto)) regions.set(row.cod_dpto, { id: row.cod_dpto, name, localities: [] });
  const region = regions.get(row.cod_dpto);
  if (region.name !== name) throw new Error('Conflicting department names.');
  region.localities.push({ id: row.cod_mpio, name: displayName(row.nom_mpio),
    ...(row.tipo_municipio !== 'Municipio' ? { kind: row.tipo_municipio } : {}) });
}
if (regions.size !== 33 || !seen.has('11001') || !seen.has('27493')) {
  throw new Error('Missing departments, Bogotá or Nuevo Belén de Bajirá.');
}
const updated = new Date(metadata.rowsUpdatedAt * 1000).toISOString().slice(0, 10);
const retrieved = new Date().toISOString().slice(0, 10);
const entries = [...regions.values()].sort((a, b) => collator.compare(a.name, b.name));
for (const region of entries) region.localities.sort((a, b) => collator.compare(a.name, b.name));
const table = entries.map(region =>
  `    { id: ${JSON.stringify(region.id)}, name: ${JSON.stringify(region.name)}, localities: [\n`
  + region.localities.map(item => `      ${JSON.stringify(item)},`).join('\n')
  + '\n    ] },'
).join('\n');
const output = `/**
 * DANE — DIVIPOLA, dataset gdxc-w37w. Data updated ${updated}; retrieved ${retrieved}.
 * Source: ${source}
 * Adaptation: codes/names only, grouped and sorted; display capitalization adjusted.
 * This data table is licensed under CC BY-SA 4.0:
 * https://creativecommons.org/licenses/by-sa/4.0/
 * Regenerate: node scripts/update-colombia-divipola.mjs [rows.json metadata.json]
 */
import type { AdministrativeCatalog } from '../core/location-catalog';

export const COLOMBIA_DIVIPOLA: AdministrativeCatalog = {
  countryCode: 'CO', countryName: 'Colombia',
  regionLabel: 'Departamento', localityLabel: 'Municipio / distrito',
  attribution: 'Departamento Administrativo Nacional de Estadística - DANE · DIVIPOLA · CC BY-SA 4.0',
  regions: [
${table}
  ],
};
`;
await writeFile(new URL('../src/data/colombia-divipola.ts', import.meta.url), output);
console.log(`Saved ${entries.length} departments/districts and ${seen.size} locations; DANE data updated ${updated}.`);
