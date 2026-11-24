import test from 'node:test';
import assert from 'node:assert/strict';
import { MEMBERS } from '../src/config/members.js';
import { normaliseSet, normaliseSn, parseLogin, memberDocId, validateMember } from '../src/utils/memberHelpers.js';

test('fixed voter roll contains 349 valid unique set/SN records', () => {
  assert.equal(MEMBERS.length, 349);
  const ids = new Set();
  for (const member of MEMBERS) {
    assert.deepEqual(validateMember(member), []);
    ids.add(memberDocId(member));
  }
  assert.equal(ids.size, 349);
});
test('set username accepts case/spacing variants but requires four-digit year', () => {
  assert.equal(normaliseSet(' SET   OF 1990 '), 1990);
  assert.equal(normaliseSet('1990'), 1990);
  assert.equal(normaliseSet('set 1990'), null);
  assert.equal(normaliseSet('nineteen ninety'), null);
});
test('S/N password is an integer in the fixed roll range format', () => {
  assert.equal(normaliseSn(' 001 '), 1);
  assert.equal(normaliseSn('0'), 0);
  assert.equal(normaliseSn('1.2'), null);
  assert.equal(normaliseSn('abc'), null);
});
test('login resolves member key without asking for a name or generating a PIN', () => {
  assert.deepEqual(parseLogin('set of 1990', '1'), { set: 1990, sn: 1 });
  assert.equal(memberDocId(parseLogin('set of 1990', '1')), '1990-1');
  assert.equal(parseLogin('set of 1990', ''), null);
});
