import test from 'node:test';
import assert from 'node:assert/strict';
import { withApiSafety } from '../api/_http.js';

test('shared API safety wrapper prevents cache storage and hides internal errors', async () => {
  const res = {
    headers: {},
    statusCode: 200,
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  const api = withApiSafety(async () => { throw new Error('private Firestore project detail'); }, 'api-test');
  await api({ method: 'POST' }, res);
  assert.equal(res.headers['Cache-Control'], 'no-store, max-age=0');
  assert.equal(res.headers.Pragma, 'no-cache');
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.message, 'The request could not be completed. Please try again.');
  assert.equal(JSON.stringify(res.body).includes('private Firestore'), false);
});
