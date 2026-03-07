const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validateEmail,
  validatePassword,
  sanitizeReason,
  validateIsoDate,
  daysBetweenInclusive
} = require('../src/utils/validation.cjs');

test('validateEmail accepts valid and rejects invalid emails', () => {
  assert.equal(validateEmail('user@example.com'), true);
  assert.equal(validateEmail('bad-email'), false);
  assert.equal(validateEmail(' user@example.com '), true);
});

test('validatePassword enforces strong password policy', () => {
  assert.equal(validatePassword('Weak123!'), false);
  assert.equal(validatePassword('StrongPass1!'), true);
  assert.equal(validatePassword('nouppercase1!'), false);
  assert.equal(validatePassword('NOLOWERCASE1!'), false);
});

test('sanitizeReason trims and normalizes user input', () => {
  assert.equal(sanitizeReason('   annual   leave   plan  '), 'annual leave plan');
});

test('validateIsoDate only accepts strict yyyy-mm-dd', () => {
  assert.equal(validateIsoDate('2026-03-07'), true);
  assert.equal(validateIsoDate('07-03-2026'), false);
  assert.equal(validateIsoDate('2026-02-30'), false);
});

test('daysBetweenInclusive returns null for invalid ranges', () => {
  assert.equal(daysBetweenInclusive('2026-03-01', '2026-03-03'), 3);
  assert.equal(daysBetweenInclusive('2026-03-03', '2026-03-01'), null);
});
