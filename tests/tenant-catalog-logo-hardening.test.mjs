import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateAgencyLogoContents } from '../src/core/agency-logo-validation.ts';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const image = (type, bytes) => new Blob([new Uint8Array(bytes)], { type });

test('public logo upload accepts only matching image file signatures', async () => {
  const valid = [
    image('image/png', [137,80,78,71,13,10,26,10,0,0,0,0,73,72,68,82]),
    image('image/jpeg', [255,216,255,224,0,16]),
    image('image/webp', [82,73,70,70,0,0,0,0,87,69,66,80,86,80]),
  ];
  for (const file of valid) {
    assert.equal(await validateAgencyLogoContents(file), null, file.type);
  }
});

test('rename tricks, invalid headers and disallowed image types are rejected', async () => {
  const files = [
    image('image/png', [...new TextEncoder().encode('<svg onload=alert(1)>')]),
    image('image/jpeg', [137,80,78,71,13,10,26,10]),
    image('image/webp', [82,73,70,70,0,0,0,0,79,79,80,83]),
    image('image/png', [137,80,78]),
    image('image/svg+xml', [...new TextEncoder().encode('<svg/>')]),
  ];
  for (const file of files) {
    assert.match(await validateAgencyLogoContents(file), /imagen|SVG/i);
  }
});

test('the image bytes must be checked before writing to public storage or sampling the palette', () => {
  const storage = read('src/lib/agency-logo-upload.ts');
  const settings = read('src/modules/settings/SettingsModule.tsx');
  assert.match(storage, /await validateAgencyLogoContents\(file\)/);
  assert.ok(storage.indexOf('await validateAgencyLogoContents(file)') <
    storage.indexOf('.upload(key,file,'), 'validate before Supabase storage upload');
  assert.match(settings, /await validateAgencyLogoContents\(file\)/);
  assert.ok(settings.indexOf('await validateAgencyLogoContents(file)') <
    settings.indexOf('await paletteFromLogoFile(file)'), 'validate before decoding palette');
  assert.match(settings, /!organizationId \|\| !can\('settings.edit'\) \|\| analyzingFile/);
});

test('catalog discards old agency responses after switching public tenant slugs', () => {
  const front = read('src/pages/PublicAgencyCatalog.tsx');
  assert.match(front, /const catalogGeneration=useRef\(0\)/);
  assert.match(front, /const generation=\+\+catalogGeneration.current/);
  assert.match(front, /if\(disposed\|\|generation!==catalogGeneration.current\)return/);
  assert.match(front, /return\(\)=>\{disposed=true;\+\+catalogGeneration.current;\}/);
  assert.match(front, /if\(generation!==catalogGeneration.current\)return/);
  assert.match(front, /setLoadingMore\(false\);setSite\(null\);setListings\(\[\]\);setSelected\(null\)/);
  assert.doesNotMatch(front, /\.from\('properties'\)/);
});
