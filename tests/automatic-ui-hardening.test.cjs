'use strict';
// Hardening regressions for site/automatic-ui.js. Run from the repository root: node --test tests/
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {wallet,A,words,requester,token,currentToken,job,ask,txHash} = require('./helpers/automatic-wallet.cjs');
const out = w => w.el('output').textContent;
const fields = ['requester','deployer','spec','brief','buildFee','reserve','job','artifact','commit','ask','topUpAmount','token'];
const buttons = ['connect','approve','open','status','commitArtifact','verdict','cancel','renew','approveTopUp','topUp','withdraw'];
const FUNDING = '0x'+A.selectors.funding;

// Wrap the helper's funding answer so the quote can name another token or reserve.
function fundingOverride(w, fn) {
  w.after = async (call, result) => {};
  const original = w.provider.request;
  w.provider.request = async function (args) {
    if (args.method === 'eth_call' && args.params[0].data.startsWith(FUNDING)) { w.calls.push(args); return fn(); }
    return original.call(this, args);
  };
  w.window.ethereum = w.provider;
}

test('funding token mismatch is a hard error for status, verdict and both top-up preflights', async () => {
  for (const button of ['status','verdict','approveTopUp','topUp']) {
    const w = wallet({allowance:1n});
    await w.el('connect').click();
    fundingOverride(w, () => words(500, 500, BigInt(currentToken)));
    // Request function is replaced, so reconnect against it before acting.
    await w.el('connect').click();
    await w.el(button).click();
    assert.match(out(w), /funding token differs/, button + ': ' + out(w));
    assert.equal(w.sent.length, 0);
  }
});

test('funding reserve mismatch is a hard error, not "quote unavailable"', async () => {
  for (const button of ['status','verdict','approveTopUp','topUp']) {
    const w = wallet({allowance:1n});
    fundingOverride(w, () => words(500, 499, BigInt(token)));
    await w.el('connect').click();
    await w.el(button).click();
    assert.match(out(w), /funding reserve differs/, button + ': ' + out(w));
    assert.equal(w.sent.length, 0);
  }
});

test('unavailable, zero and underfunded quotes never enable the verdict; status still displays them', async () => {
  for (const options of [{available:false},{price:0n},{price:501n}]) {
    const w = wallet(options);
    await w.el('connect').click();
    await w.el('status').click();
    assert.equal(JSON.parse(out(w)).verdictReadiness.ready, false);
    await w.el('verdict').click();
    assert.match(out(w), /not ready/);
    assert.equal(w.sent.length, 0);
  }
});

test('bind disables every field and button during an action and restores original flags', async () => {
  const w = wallet();
  w.el('withdraw').disabled = true; w.el('artifact').disabled = true;
  let seen = null;
  w.before = c => { if (!seen && c.method === 'eth_chainId') seen = [...fields, ...buttons].every(id => w.el(id).disabled); };
  await w.el('connect').click();
  assert.equal(seen, true, 'all controls disabled before the first await resolved');
  assert.equal(w.el('withdraw').disabled, true); assert.equal(w.el('artifact').disabled, true);
  assert.equal(w.el('approve').disabled, false); assert.equal(w.el('brief').disabled, false);
});

function receiptWith(w, logs) {
  const original = w.provider.request;
  w.provider.request = async function (args) {
    if (args.method === 'eth_getTransactionReceipt') { w.calls.push(args); return {status:'0x1', logs}; }
    return original.call(this, args);
  };
  w.window.ethereum = w.provider;
}
const TOPIC = '0x95e6cf60266f65ecf4a509b236fccd720bc64ef7099f4a859a49d18cab89334c';
const good = {address:requester, topics:[TOPIC, job]};

for (const [name, logs, pattern] of [
  ['missing', [], /Missing JobOpened/],
  ['duplicate', [good, good], /Multiple JobOpened/],
  ['removed', [{...good, removed:true}], /removed by a reorg/],
  ['other emitter', [{...good, address:token}], /Missing JobOpened/],
  ['zero id', [{...good, topics:[TOPIC, '0x'+'00'.repeat(32)]}], /Zero JobOpened/],
  ['invalid id', [{...good, topics:[TOPIC, '0x1234']}], /Invalid JobOpened/],
]) test('open rejects ' + name + ' JobOpened logs without publishing IDs or resending', async () => {
  const w = wallet();
  receiptWith(w, logs);
  await w.el('connect').click();
  w.el('job').value = ''; w.el('ask').value = '';
  await w.el('open').click();
  assert.match(out(w), pattern, out(w));
  assert.equal(w.el('job').value, ''); assert.equal(w.el('ask').value, '');
  assert.equal(w.sent.length, 1, 'no automatic resend');
  assert.deepEqual(JSON.parse(out(w)).transactions, [txHash], 'submitted hash preserved');
});

for (const [name, overrides, pattern] of [
  ['absent job', {status:0}, /absent/],
  ['zero ask', {ask:'0x'+'00'.repeat(32)}, /no ask/],
]) test('open rejects ' + name + ' on readback', async () => {
  const w = wallet(overrides);
  await w.el('connect').click();
  w.el('job').value = ''; w.el('ask').value = '';
  await w.el('open').click();
  assert.match(out(w), pattern, out(w));
  assert.equal(w.el('job').value, '');
  assert.equal(w.sent.length, 1);
});

test('open accepts explicit removed:false and a slow receipt that already shows Delivered', async () => {
  const w = wallet({status:2});
  receiptWith(w, [{...good, removed:false}]);
  await w.el('connect').click();
  w.el('job').value = ''; w.el('ask').value = '';
  await w.el('open').click();
  assert.equal(w.el('job').value, job, out(w));
  assert.equal(w.el('ask').value, ask);
  assert.equal(JSON.parse(out(w)).jobStatus, 'Delivered');
});

test('errors keep previous fields', async () => {
  const w = wallet({available:true});
  await w.el('connect').click();
  w.el('job').value = job; w.el('ask').value = ask;
  w.state.price = 0n;
  await w.el('verdict').click();
  assert.equal(w.el('job').value, job); assert.equal(w.el('ask').value, ask);
});
