import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getReviewOtp } from '../reviewOtp.js';

test('only listed numbers get a fixed code', () => {
  const config = '9000000001:1234, 9000000002:5678';
  assert.equal(getReviewOtp('9000000001', config), '1234');
  assert.equal(getReviewOtp('+91 90000 00001', config), '1234');
  assert.equal(getReviewOtp('9000000002', config), '5678');
  assert.equal(getReviewOtp('9000000003', config), null);
});

test('unset, malformed or empty settings never give a code', () => {
  for (const config of ['', undefined, '9000000001', '9000000001:', ':1234', '*:1234', '9000000001:12345']) {
    assert.equal(getReviewOtp('9000000001', config || ''), null);
  }
  assert.equal(getReviewOtp('', ':1234'), null);
});
