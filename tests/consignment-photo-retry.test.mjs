import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const modal = readFileSync(new URL('../src/components/SubmitPropertyModal.tsx', import.meta.url), 'utf8');

test('photo retry resumes from acknowledged image count and retains the same consignment reference', () => {
  assert.match(modal, /const retryPhotoUploads = async \(\) =>/);
  assert.match(modal, /attemptPhotoUploads\(createdCode, uploadedPhotos\)/);
  assert.match(modal, /await attemptPhotoUploads\(reference, 0\)/);
  assert.match(modal, /await uploadConsignmentPhoto\(site\.slug, request\.current\.id, reference, i, photos\[i\]\)/);
  assert.match(modal, /setUploadedPhotos\(i \+ 1\)/);
  assert.match(modal, /submitLock\.current \|\| !createdCode/);
});

test('retry is visibly offered only for incomplete photo uploads', () => {
  assert.match(modal, /uploadedPhotos < photos\.length && <button/);
  assert.match(modal, /Reintentar fotografías pendientes/);
  assert.match(modal, /disabled=\{submitting\}/);
  assert.match(modal, /Fotografías confirmadas:/);
});

test('a failed photo upload does not falsely report all photos as saved', () => {
  const submit = modal.slice(modal.indexOf('const handleSubmit = async'));
  assert.match(submit, /setCreatedCode\(reference\)/);
  assert.match(submit, /await attemptPhotoUploads\(reference, 0\)/);
  assert.match(modal, /setPhotoWarning\(/);
  assert.doesNotMatch(modal, /Fotografías guardadas: \{photos\.length\}/);
});
