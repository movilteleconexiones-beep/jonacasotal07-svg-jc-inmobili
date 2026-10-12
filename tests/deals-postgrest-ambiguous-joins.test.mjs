import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const deals = readFileSync(new URL('../src/modules/deals/DealsModule.tsx', import.meta.url),'utf8');
const commissions = readFileSync(new URL('../src/modules/commissions/CommissionsModule.tsx', import.meta.url),'utf8');

test('deal list disambiguates both tenant and legacy foreign keys to contacts and properties',()=>{
  assert.match(deals,/contacts!deals_contact_id_fkey\(first_name,last_name\)/);
  assert.match(deals,/properties!deals_property_id_fkey\(code,title,currency\)/);
  assert.doesNotMatch(deals,/(?<!\!)contacts\(first_name,last_name\)/);
  assert.doesNotMatch(deals, /(?<!\!)properties\(code,title,currency\)/);
});

test('commission embedded deals also specify the exact nested foreign keys',()=>{
  assert.match(commissions,/deals\(properties!deals_property_id_fkey\(code,title\),contacts!deals_contact_id_fkey\(first_name,last_name\)\)/);
  assert.match(commissions,/\.select\('id,stage,properties!deals_property_id_fkey\(code,title\),contacts!deals_contact_id_fkey\(first_name,last_name\)'\)/);
  assert.doesNotMatch(commissions, /(?<!\!)properties\(code,title\)/);
});

test('deal count is only shown after successful query; failed queries are not reported as no deals',()=>{
  assert.match(deals,/const \[dealListState, setDealListState\] = useState/);
  assert.match(deals,/if \(dealResult\.error\) \{\s*setDealListState\('error'\)/);
  assert.match(deals,/setDealListState\('ready'\)/);
  assert.match(deals,/Negocios registrados: ' \+ rows\.length/);
  assert.match(deals,/Cantidad no disponible por error de consulta/);
  assert.match(deals,/No fue posible cargar los negocios\. Los registros pueden seguir en la base de datos/);
  assert.match(deals,/dealListState === 'error'/);
});
