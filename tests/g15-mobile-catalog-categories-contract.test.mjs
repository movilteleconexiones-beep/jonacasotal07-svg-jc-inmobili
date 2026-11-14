import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');
test('G15 catalog filter chips wrap below 640px without hiding overflow',()=>{
 assert.match(source,/inline-flex max-w-full min-w-0 flex-wrap items-center gap-1 p-1 bg-stone-200\/70 rounded-lg sm:flex-nowrap sm:gap-0/);
 assert.match(source,/\(\['Todas', 'Residencial', 'Departamento', 'Comercial y Terreno'\] as const\)/);
 assert.match(source,/setCategoryFilter\(cat\)/);
 assert.doesNotMatch(source,/overflow-x-hidden|overflow-hidden.*catalogo/);
});
