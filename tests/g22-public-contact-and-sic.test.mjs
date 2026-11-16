import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const app=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');

test('G22 public contact never shows an invented or empty telephone link',()=>{
 assert.doesNotMatch(app,/300 123 4567|\+573001234567/);
 assert.match(app,/const publishedPhone = typeof branding\.phone === 'string'/);
 assert.match(app,/\{publishedPhone \? <a/);
 assert.match(app,/Teléfono no publicado/);
 assert.match(app,/tel:\$\{publishedPhone\.replace/);
});
test('G22 provides visible Colombian consumer authority link on public footer',()=>{
 assert.match(app,/https:\/\/www\.sic\.gov\.co\//);
 assert.match(app,/Derechos del consumidor · SIC/);
 assert.match(app,/rel="noopener noreferrer"/);
});
