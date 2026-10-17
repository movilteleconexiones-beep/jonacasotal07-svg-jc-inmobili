import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mergeDistinctListings } from '../src/core/public-listing-pagination.ts';

const catalog = readFileSync(
  new URL('../src/pages/PublicAgencyCatalog.tsx', import.meta.url),
  'utf8',
);

test('duplicate IDs across and within pages render only once', () => {
  const first = [{ id: 'A', title: 'First' }, { id: 'B', title: 'Second' }];
  const next = [
    { id: 'B', title: 'Later duplicate' },
    { id: 'C', title: 'Third' },
    { id: 'C', title: 'Repeated third' },
    { id: 'D', title: 'Fourth' },
  ];
  const merged = mergeDistinctListings(first, next);
  assert.deepEqual(merged.map(item => item.id), ['A', 'B', 'C', 'D']);
  assert.equal(merged[1].title, 'Second', 'preserve the first authorized record');
  assert.deepEqual(first.map(item => item.id), ['A', 'B'], 'do not mutate existing state');
  assert.deepEqual(next.map(item => item.id), ['B', 'C', 'C', 'D'], 'do not mutate RPC data');
  assert.deepEqual(mergeDistinctListings(merged, next), merged, 'a retry is idempotent');
});

test('no-op pages retain a stable empty / initial catalog', () => {
  assert.deepEqual(mergeDistinctListings([], []), []);
  assert.deepEqual(mergeDistinctListings([], [{ id: 'A' }]), [{ id: 'A' }]);
});

test('load more acquires a synchronous lock and releases only within its generation', () => {
  const handler = catalog.slice(catalog.indexOf('  async function loadMore(){'), catalog.indexOf('  const visible=useMemo('));
  assert.ok(handler.startsWith('  async function loadMore(){'));
  assert.match(catalog, /const loadMoreInFlight=useRef\(false\)/);
  assert.match(handler, /loadingMore\|\|loadMoreInFlight\.current\|\|!hasMore/);
  assert.ok(handler.indexOf('loadMoreInFlight.current=true') < handler.indexOf("await supabase.rpc('get_public_agency_listings'"));
  assert.match(handler, /setListings\(items=>mergeDistinctListings\(items,nextPage\)\)/);
  assert.match(handler, /finally\s*\{/);
  assert.match(handler, /if\(generation===catalogGeneration\.current\)\s*\{\s*loadMoreInFlight\.current=false/);
  assert.match(catalog, /loadMoreInFlight\.current=false;\s*nextPageOffset\.current=0;\s*setLoading\(true\)/);
  assert.match(catalog, /nextPageOffset\.current=catalogResult\.data\.length/);
  assert.match(handler, /p_offset:nextPageOffset\.current/);
  assert.match(handler, /nextPageOffset\.current\+=nextPage\.length/);
  assert.doesNotMatch(handler, /p_offset:listings\.length/);
  assert.match(handler, /if\(generation!==catalogGeneration\.current\)return/);
});
