'use strict';
(() => {
  const A = AutoHooks, el = id => document.getElementById(id);
  const fields = ['requester','deployer','spec','brief','buildFee','reserve','job','artifact','commit','ask','topUpAmount','token'];
  const buttons = ['connect','approve','open','status','commitArtifact','verdict','cancel','renew','approveTopUp','topUp','withdraw'];
  let connection = null, revision = 0, busy = false;
  const watched = new WeakSet();
  const show = value => { el('output').textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2); };
  const invalidate = () => { connection = null; el('account').textContent = ''; };
  function drift(reason) {
    invalidate();
    const err = Error(reason + '; reconnect before continuing.');
    err.contextChanged = true;
    throw err;
  }
  function watch(provider) {
    if (!provider || watched.has(provider)) return;
    watched.add(provider);
    if (typeof provider.on === 'function') {
      for (const event of ['accountsChanged','chainChanged','disconnect']) {
        provider.on(event, () => { ++revision; invalidate(); });
      }
    }
  }
  for (const id of fields) for (const event of ['input','change']) {
    el(id).addEventListener(event, () => { ++revision; if (id === 'requester') invalidate(); });
  }
  watch(window.ethereum);

  // Capture every raw value before the first await. Even whitespace edits and edits to an
  // unrelated field invalidate an in-flight operation; parsed calldata uses only this copy.
  function capture(connecting = false) {
    const provider = window.ethereum, request = provider?.request;
    if (!provider || typeof request !== 'function') drift('A wallet provider is required');
    watch(provider);
    const raw = Object.freeze(Object.fromEntries(fields.map(id => [id, el(id).value])));
    const form = Object.freeze(Object.fromEntries(fields.map(id => [id, raw[id].trim()])));
    const requester = '0x' + A.hex(form.requester, 20);
    if (!connecting) {
      if (!connection) throw Error('Connect your wallet first');
      if (provider !== connection.provider || request !== connection.request || raw.requester !== connection.requesterRaw) {
        drift('Wallet provider, request function or requester changed');
      }
    }
    return Object.freeze({provider, request, raw, form, requester, revision, connecting, connection,
      account: connecting ? undefined : connection.account, chainId: connecting ? undefined : connection.chainId,
      hashes: []});
  }
  function checkLocal(c) {
    if (window.ethereum !== c.provider || c.provider.request !== c.request) drift('Wallet provider or request function changed');
    if (revision !== c.revision || fields.some(id => el(id).value !== c.raw[id])) drift('Form or wallet context changed');
    if (!c.connecting && connection !== c.connection) drift('Connection changed');
  }
  function chainId(raw) {
    if (typeof raw !== 'string' || !/^0x[0-9a-f]+$/i.test(raw) || BigInt(raw) === 0n) drift('Invalid wallet chain');
    return '0x' + BigInt(raw).toString(16);
  }
  async function checkContext(c) {
    checkLocal(c);
    if (c.account !== undefined) {
      const accounts = await c.request.call(c.provider, {method:'eth_accounts', params:[]});
      checkLocal(c);
      if (!Array.isArray(accounts) || accounts[0]?.toLowerCase() !== c.account) drift('Wallet account changed');
    }
    if (c.chainId !== undefined) {
      const chain = await c.request.call(c.provider, {method:'eth_chainId', params:[]});
      checkLocal(c);
      if (chainId(chain) !== c.chainId) drift('Wallet chain changed');
    }
    checkLocal(c);
  }
  async function rpc(c, method, params) {
    await checkContext(c);
    checkLocal(c);
    let result;
    try {
      result = await c.request.call(c.provider, {method, params});
      // Record the submission before ANY post-send check can fail. Never suggest resending
      // merely because the wallet/form changed while the wallet was returning the hash.
      if (method === 'eth_sendTransaction') c.hashes.push(result);
    } catch (err) {
      await checkContext(c);
      throw err;
    }
    await checkContext(c);
    checkLocal(c);
    return result;
  }
  const call = (c, to, data) => rpc(c, 'eth_call', [{to, data}, 'latest']);
  const read = (c, kind, id) => call(c, c.requester, A.idCalldata(kind, id));
  const scalar = (c, kind) => call(c, c.requester, '0x' + A.selectors[kind]);
  const allowance = async (c, token) => BigInt('0x' + A.hex(await call(c, token,
    '0xdd62ed3e' + A.address(c.account) + A.address(c.requester)), 32));

  async function send(c, to, data) {
    const base = Object.freeze({from:c.account, chainId:c.chainId, to, data, value:'0x0'});
    // Providers can mutate the estimate object. The send payload is rebuilt from the snapshot.
    const gas = await rpc(c, 'eth_estimateGas', [{...base}]);
    const hash = await rpc(c, 'eth_sendTransaction', [{...base, gas}]);
    A.hex(hash, 32);
    show({transaction:hash, status:'Submitted; waiting up to 120 seconds for inclusion, not finality'});
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      const receipt = await rpc(c, 'eth_getTransactionReceipt', [hash]);
      if (receipt) {
        if (receipt.status !== '0x1') throw Error('Transaction reverted: ' + hash);
        return receipt;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw Error('Receipt deadline reached; transaction may still be pending: ' + hash);
  }
  async function finish(c, result, updates = {}) {
    await checkContext(c);
    checkLocal(c);
    // Publish derived fields only once every check has passed; never let them change a pending snapshot.
    for (const [id, value] of Object.entries(updates)) el(id).value = value;
    if (c.hashes.length) result = {...result, transaction:c.hashes[c.hashes.length - 1],
      receiptNote:'Mined and read back; confirm chain finality before relying on it'};
    show(result);
  }
  function bind(id, fn) {
    el(id).addEventListener('click', async () => {
      if (busy) return;
      busy = true;
      // Snapshot every field and button flag before the first await, so a control that was
      // deliberately disabled stays disabled after this action, and nothing is editable meanwhile.
      const controls = [...fields, ...buttons].map(name => [el(name), el(name).disabled]);
      for (const [control] of controls) control.disabled = true;
      let c;
      try { c = capture(id === 'connect'); await fn(c); }
      catch (err) {
        // Fail closed after a rejected context probe too, including RPC disconnects without events.
        invalidate();
        show(c?.hashes.length ? {error:err.message, transactions:c.hashes,
          next:'Reconnect and inspect these hashes before another transaction. Submission may have succeeded.'} : err.message);
      } finally {
        busy = false;
        for (const [control, was] of controls) control.disabled = was;
      }
    });
  }
  bind('connect', async initial => {
    invalidate();
    let c = Object.freeze({...initial, chainId:chainId(await rpc(initial, 'eth_chainId', []))});
    const accounts = await rpc(c, 'eth_requestAccounts', []);
    if (!Array.isArray(accounts) || !accounts.length) throw Error('Wallet returned no account');
    c = Object.freeze({...c, account:'0x' + A.hex(accounts[0], 20)});
    if (BigInt(await scalar(c, 'automatic')) !== 1n) throw Error('Automatic requester required');
    const token = '0x' + A.hex(await scalar(c, 'asset'), 32).slice(-40);
    await checkContext(c);
    checkLocal(c);
    connection = Object.freeze({provider:c.provider, request:c.request, account:c.account, chainId:c.chainId,
      requester:c.requester, requesterRaw:c.raw.requester});
    el('account').textContent = c.account + ' on chain ' + BigInt(c.chainId).toString();
    el('token').value = token;
    show('Automatic requester verified. Read the contract and operator configuration before paying.');
  });
  async function openParameters(c) {
    const spec = JSON.parse(c.form.spec);
    if (BigInt(spec.chainId) !== BigInt(c.chainId)) throw Error('Wallet network differs from HookSpec');
    const data = A.openCalldata(spec, c.form.deployer, c.form.brief, c.form.buildFee, c.form.reserve);
    await scalar(c, 'head');
    const uses = await call(c, c.form.deployer, '0xb61e96a5'); // requester()
    if (A.hex(uses, 32).slice(-40) !== c.requester.slice(2)) throw Error('Deployer uses another requester');
    return data;
  }
  bind('approve', async c => {
    await openParameters(c);
    const token = '0x' + A.hex(await scalar(c, 'asset'), 32).slice(-40);
    const intake = '0x' + A.hex(await scalar(c, 'intake'), 32).slice(-40);
    const action = await scalar(c, 'jobAction');
    const price = BigInt(await call(c, intake, '0x51102885' + A.hex(action, 32) + A.address(token)));
    if (price === 0n || price > BigInt(c.form.buildFee)) throw Error('Build price unavailable or above cap');
    const amount = price + BigInt(c.form.reserve);
    await send(c, token, '0x095ea7b3' + A.address(c.requester) + A.uint(amount));
    const actual = await allowance(c, token);
    if (actual !== amount) throw Error('Approval readback differs from the bounded amount');
    await finish(c, {token, approvedPrepayment:amount.toString(), allowanceReadback:actual.toString(),
      next:'Approval confirmed. Open the job with a separate transaction.'});
  });
  const JOB_OPENED = '0x95e6cf60266f65ecf4a509b236fccd720bc64ef7099f4a859a49d18cab89334c';
  bind('open', async c => {
    const receipt = await send(c, c.requester, await openParameters(c));
    const opened = (Array.isArray(receipt.logs) ? receipt.logs : []).filter(l =>
      typeof l?.address === 'string' && l.address.toLowerCase() === c.requester &&
      Array.isArray(l.topics) && typeof l.topics[0] === 'string' && l.topics[0].toLowerCase() === JOB_OPENED);
    // Exactly one requester JobOpened. Duplicates (even the same log twice) are ambiguous.
    if (opened.length !== 1) throw Error((opened.length ? 'Multiple' : 'Missing') +
      ' JobOpened logs in the receipt; inspect the transaction before continuing. Do not resend.');
    const [log] = opened;
    if (log.removed !== undefined && log.removed !== false) throw Error('JobOpened log was removed by a reorg; inspect the transaction. Do not resend.');
    let job;
    try { job = '0x' + A.hex(log.topics[1], 32); } catch { throw Error('Invalid JobOpened job ID; inspect the transaction. Do not resend.'); }
    if (BigInt(job) === 0n) throw Error('Zero JobOpened job ID; inspect the transaction. Do not resend.');
    const status = await readStatus(c, job);
    const {decoded, ask, context, reserve} = status.state;
    // A slow receipt may already show Delivered/Failed/Expired; only an absent job is wrong.
    if (decoded.status === 0 || BigInt('0x' + decoded.words[0]) === 0n) throw Error('Opened job is absent on readback; inspect the transaction.');
    if (decoded.requester !== c.account) throw Error('Opened job belongs to another requester account; inspect the transaction.');
    if (BigInt(ask) === 0n) throw Error('Opened job has no ask on readback; inspect the transaction.');
    if (BigInt(reserve.token) === 0n) throw Error('Opened job has no reserve token on readback; inspect the transaction.');
    if (context.slice(0, 64) !== A.hex(job, 32)) throw Error('Ask readback is linked to another job; inspect the transaction.');
    // IDs are published only now, after every readback passed.
    await finish(c, status.display, {job, ask});
  });
  async function readReserve(c, job) {
    return A.decodeReserve(await read(c, 'reserve', job), await read(c, 'reserveDeadline', job));
  }
  async function readPhase(c, ask) {
    return A.decodeReadiness(await read(c, 'readiness', ask), await scalar(c, 'depth'));
  }
  // `reserve` is the original job reserve (readReserve). A quote that cannot be read is shown as
  // unavailable; a quote that reads but names another token or reserve is a hard error.
  async function readReadiness(c, ask, reserve) {
    if (!reserve || typeof reserve.token !== 'string' || BigInt('0x' + A.hex(reserve.token, 20)) === 0n ||
        !/^(0|[1-9][0-9]*)$/.test(String(reserve.amount))) throw Error('Original reserve readback missing; refresh status');
    const phase = await readPhase(c, ask);
    let funding;
    try { funding = A.decodeFunding(await read(c, 'funding', ask)); }
    catch (err) {
      // Only an unavailable quote is displayable. Context drift must still abort the whole action.
      if (err.contextChanged) throw err;
      await checkContext(c);
      funding = {available:false, funded:false, error:err.message};
    }
    // Outside the catch: a mismatch must never be downgraded to "quote unavailable".
    if (funding.available) {
      if (funding.token !== reserve.token.toLowerCase()) throw Error('Verdict funding token differs from the original reserve token; refresh status');
      if (!/^(0|[1-9][0-9]*)$/.test(funding.reserve) || BigInt(funding.reserve) !== BigInt(reserve.amount)) {
        throw Error('Verdict funding reserve differs from the original reserve; refresh status');
      }
    }
    return A.fundedReadiness(phase, funding);
  }
  async function readState(c, job) {
    const raw = '0x' + A.hex(await read(c, 'job', job), 480);
    const decoded = A.decodeJob(raw);
    const ask = '0x' + A.hex(await read(c, 'ask', job), 32);
    const candidate = '0x' + A.hex(await read(c, 'candidate', job), 32);
    const context = A.hex(await read(c, 'askContext', ask), 288);
    return {job, raw, decoded, ask, candidate, context, reserve:await readReserve(c, job)};
  }
  async function readStatus(c, job) {
    const state = await readState(c, job);
    const {words, status, review} = state.decoded;
    const approved = await read(c, 'approved', job);
    const epoch = await call(c, c.requester, '0x' + A.selectors.epoch + words[13]);
    const incident = BigInt(epoch) === 0n ? null : await call(c, c.requester, '0x' + A.selectors.revoked + A.uint(BigInt(epoch)));
    const readiness = await readReadiness(c, state.ask, state.reserve);
    return {state, display:{job, ask:state.ask, jobStatus:['None','Open','Delivered','Failed','Expired'][status],
      verdict:['None','Pending','Passed','NotPassed','Unanswered'][review], exactAuthorizedArtifact:approved,
      signerEpoch:BigInt(epoch).toString(), revokedEpochIncident:incident, verdictReadiness:readiness, reserve:state.reserve,
      note:'A Passed label alone cannot deploy: exact artifact, signer revocation, freshness, manager, bytecode and replay checks still apply.'}};
  }
  async function showStatus(c) {
    const status = await readStatus(c, c.form.job);
    await finish(c, status.display, {ask:status.state.ask});
  }
  bind('status', showStatus);
  bind('commitArtifact', async c => {
    const state = A.decodeJob(await read(c, 'job', c.form.job));
    if (state.status !== 2) throw Error('Wait for Delivered before committing an artifact.');
    if ((await readReserve(c, c.form.job)).cancelled) throw Error('Cancelled reserve cannot be revived.');
    if (state.requester !== c.account) throw Error('Only the job requester can commit an artifact.');
    const data = A.commitCalldata(c.form.job, JSON.parse(c.form.artifact), c.form.commit);
    await send(c, c.requester, data);
    await showStatus(c);
  });
  bind('verdict', async c => {
    const readiness = await readReadiness(c, c.form.ask, await readReserve(c, c.form.job));
    if (!readiness.ready) throw Error('Verdict not ready: ' + readiness.blocksRemaining +
      ' native blocks remaining. Delivery, candidate, active reserve, deadline and a positive quote within reserve are required. Refresh status; top up if needed.');
    if (A.hex(await read(c, 'ask', c.form.job), 32) !== A.hex(c.form.ask, 32)) throw Error('Job and ask differ; refresh status');
    await send(c, c.requester, A.idCalldata('verdict', c.form.ask));
    await showStatus(c);
  });
  for (const id of ['cancel','renew']) bind(id, async c => {
    await send(c, c.requester, A.idCalldata(id, c.form.job));
    await showStatus(c);
  });
  async function topUpParameters(c) {
    const job = c.form.job, amount = c.form.topUpAmount, data = A.topUpCalldata(job, amount);
    const state = await readState(c, job), {decoded, reserve, ask, context, candidate} = state;
    if (decoded.requester !== c.account) throw Error('Only the job requester can top up.');
    if (decoded.status !== 2 || decoded.review !== 0) throw Error('Top-up requires Delivered with review None.');
    if (reserve.cancelled) throw Error('Cancelled reserve cannot be revived.');
    if (BigInt(candidate) === 0n) throw Error('Commit an artifact before topping up.');
    if (BigInt(ask) === 0n || context.slice(0, 64) !== A.hex(job, 32)) throw Error('Job and ask context differ');
    if (BigInt('0x' + context.slice(64, 128)) !== 0n) throw Error('Top-up requires an unspent ask.');
    if (c.form.ask && A.hex(c.form.ask, 32) !== A.hex(ask, 32)) throw Error('Job and ask differ; refresh status');
    const cap = BigInt('0x' + A.hex(await call(c, c.requester,
      '0x' + A.selectors.maxPriceOf + A.address(reserve.token)), 32));
    if (BigInt(reserve.amount) + BigInt(amount) > cap) throw Error('Total reserve exceeds current maxPriceOf for the reserve token.');
    // Funding token/reserve must agree with the original reserve before either top-up step.
    await readReadiness(c, ask, reserve);
    const phase = await readPhase(c, ask);
    const head = BigInt('0x' + A.hex(await scalar(c, 'head'), 32));
    return {job, ask, amount, data, state, phase, head, token:reserve.token};
  }
  function sameState(before, after, delta, refreshing = false) {
    if (['job','raw','ask','candidate','context'].some(key => before[key] !== after[key]) ||
        before.reserve.token !== after.reserve.token || before.reserve.cancelled !== after.reserve.cancelled ||
        BigInt(after.reserve.amount) !== BigInt(before.reserve.amount) + delta ||
        (!refreshing && before.reserve.reserveDeadline !== after.reserve.reserveDeadline)) {
      throw Error('Job, ask, candidate, context or exact reserve readback changed; inspect the transaction');
    }
  }
  bind('approveTopUp', async c => {
    const p = await topUpParameters(c);
    await send(c, p.token, '0x095ea7b3' + A.address(c.requester) + A.uint(p.amount));
    const actual = await allowance(c, p.token);
    if (actual !== BigInt(p.amount)) throw Error('Top-up approval readback differs from the bounded amount. Refresh before continuing.');
    sameState(p.state, await readState(c, p.job), 0n);
    await finish(c, {job:p.job, ask:p.ask, token:p.token, approvedTopUp:p.amount, allowanceReadback:actual.toString(),
      next:'Approval confirmed. Submit the separate top-up transaction, then wait eight native blocks.'});
  });
  bind('topUp', async c => {
    const p = await topUpParameters(c);
    await send(c, c.requester, p.data);
    const status = await readStatus(c, p.job);
    sameState(p.state, status.state, BigInt(p.amount), true);
    const phase = status.display.verdictReadiness;
    if (BigInt(status.state.reserve.reserveDeadline) < BigInt(p.state.reserve.reserveDeadline) ||
        BigInt(phase.fromBlock) < p.head || BigInt(phase.fromBlock) > BigInt(phase.nativeHead) ||
        phase.windowDepth !== p.phase.windowDepth ||
        (BigInt(phase.blocksRemaining) > 0n && phase.phaseReady)) {
      throw Error('Top-up maturity or reserve deadline readback was not refreshed');
    }
    // Recheck identity/reserve after the ancillary status and funding reads as well.
    sameState(status.state, await readState(c, p.job), 0n);
    await finish(c, status.display, {ask:p.ask});
  });
  bind('withdraw', async c => {
    await send(c, c.requester, '0x' + A.selectors.withdraw + A.address(c.form.token));
    await finish(c, {token:c.form.token, status:'Refund withdrawal receipt checked'});
  });
})();
