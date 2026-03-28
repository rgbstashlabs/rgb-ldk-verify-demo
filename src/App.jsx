import React, { useState, useEffect, useCallback } from 'react';
import { AppContext, defaultState, defaultConfig } from './store';
import { api, bitcoin, bitcoinAdmin, serverAction, sha256hex, randHex } from './api';
import { Sidebar } from './components/Sidebar';
import { StatusBar } from './components/StatusBar';
import { StatePanel } from './components/StatePanel';
import { ResponsePanel, Button } from './components/UI';
import { getSteps } from './steps';

// ── Swap session-storage helpers ─────────────────────────────────────────────
// Preimage survives same-tab page refreshes (sessionStorage) but is automatically
// cleared when the browser tab is closed — scoped to this swap session.
const SWAP_STORAGE_KEY = 'rgb_swap_preimage_v1';
const HTLC_EXPIRY_MS   = 3600 * 1000;  // must match expiry_secs: 3600 in runSwapStep1
const HTLC_SAFETY_MS   = 120_000;      // refuse step③/④ if < 2 min remain before expiry

function saveSwapToSession(preimage, paymentHash, holdInvoice = null) {
  sessionStorage.setItem(SWAP_STORAGE_KEY, JSON.stringify({
    preimage,
    paymentHash,
    holdInvoice,
    step3Completed: false,  // only becomes true after PaymentSuccessful is confirmed
    createdAt: Date.now(),
  }));
}

// Called after step③ PaymentSuccessful is confirmed — persists completion state
// so that after a page refresh, swapUnlocked[4] is correctly restored to true.
function markSwapStep3Complete() {
  try {
    const raw = sessionStorage.getItem(SWAP_STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    sessionStorage.setItem(SWAP_STORAGE_KEY, JSON.stringify({ ...data, step3Completed: true }));
  } catch { /* ignore storage errors */ }
}

function loadSwapFromSession() {
  try {
    const raw = sessionStorage.getItem(SWAP_STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    const elapsed = Date.now() - data.createdAt;
    if (elapsed >= HTLC_EXPIRY_MS) {
      sessionStorage.removeItem(SWAP_STORAGE_KEY);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function clearSwapSession() {
  sessionStorage.removeItem(SWAP_STORAGE_KEY);
}

function getRemainingHtlcMs() {
  const data = loadSwapFromSession();
  if (!data) return 0;
  return HTLC_EXPIRY_MS - (Date.now() - data.createdAt);
}

export default function App() {
  const [config, setConfig] = useState(defaultConfig);
  const [state, setState] = useState(defaultState);
  const [nodeStatus, setNodeStatus] = useState({ alice: null, bob: null, btc: null });

  const [currentStep, setCurrentStep] = useState(0);
  const [stepDone, setStepDone] = useState(new Set());
  const [stepError, setStepError] = useState(new Set());

  const [stepStates, setStepStates] = useState({});
  const [swapUnlocked, setSwapUnlocked] = useState({ 1: false, 2: false, 3: false, 4: false });

  const updateState = (updates) => setState(prev => ({ ...prev, ...updates }));

  const markDone = (i) => {
    setStepDone(prev => { const next = new Set(prev); next.add(i); return next; });
    setStepError(prev => { const next = new Set(prev); next.delete(i); return next; });
  };

  const markError = (i) => {
    setStepError(prev => { const next = new Set(prev); next.add(i); return next; });
    setStepDone(prev => { const next = new Set(prev); next.delete(i); return next; });
  };

  const setStepState = (id, loading, status, data, btnText, btnVariant = 'primary') => {
    setStepStates(prev => ({
      ...prev,
      [id]: { loading, status, data, btnText, btnVariant }
    }));
  };

  const refreshStatus = useCallback(async () => {
    try {
      const [as, bs, bc] = await Promise.all([
        api('alice', '/api/v1/status').catch(() => null),
        api('bob',   '/api/v1/status').catch(() => null),
        fetch('/bitcoin', {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({jsonrpc:'1.0',method:'getblockchaininfo',params:[],id:'1'})
        }).then(r=>r.json()).catch(() => null),
      ]);
      setNodeStatus({ alice: as, bob: bs, btc: bc });
    } catch (_) {}
  }, []);

  const restoreState = useCallback(async (manual = false) => {
    const log = [];
    let updates = {};
    try {
      const [aId, bId] = await Promise.all([
        api('alice', '/api/v1/node_id').catch(() => null),
        api('bob',   '/api/v1/node_id').catch(() => null),
      ]);

      if (aId?.data?.node_id) { updates.aliceNodeId = aId.data.node_id; log.push('aliceNodeId'); }
      if (bId?.data?.node_id) { updates.bobNodeId = bId.data.node_id; log.push('bobNodeId'); }

      const chans = await api('alice', '/api/v1/channels').catch(() => null);
      if (chans?.data?.length) {
        const ch = chans.data[0];
        updates.userChannelId = ch.user_channel_id;
        updates.channelId = ch.channel_id;
        log.push('userChannelId', 'channelId');
        if (ch.rgb_balance?.asset_id) {
          updates.assetId = ch.rgb_balance.asset_id;
          log.push('assetId=' + updates.assetId.slice(0, 8) + '…');
        }
      }

      if (updates.assetId || state.assetId) {
        const assetId = updates.assetId || state.assetId;
        const contracts = await api('alice', '/api/v1/rgb/contracts').catch(() => null);
        if (contracts?.data?.contracts) {
          const match = contracts.data.contracts.find(c => c.asset_id === assetId);
          if (match) { updates.contractId = match.contract_id; log.push('contractId'); }
        }
      }

      // Restore swap preimage from sessionStorage so a page refresh doesn't
      // strand Alice's funds when she's already sent TTK but hasn't claimed BTC.
      const savedSwap = loadSwapFromSession();
      if (savedSwap && !updates.swapPreimage) {
        updates.swapPreimage    = savedSwap.preimage;
        updates.swapPaymentHash = savedSwap.paymentHash;
        // Restore holdInvoice so step② can still execute after a page refresh.
        if (savedSwap.holdInvoice) updates.holdInvoice = savedSwap.holdInvoice;
        const remainingSec = Math.floor(getRemainingHtlcMs() / 1000);
        log.push(`swapPreimage (${remainingSec}s left on HTLC)`);
        // Only re-unlock step④ if step③ was confirmed complete before the refresh.
        // Unconditionally unlocking ④ would bypass the Exit Scam guard in runSwapStep4.
        setSwapUnlocked({
          1: true,
          2: true,
          3: true,
          4: savedSwap.step3Completed === true,
        });
      }

      if (Object.keys(updates).length > 0) {
        updateState(updates);
      }

      if (manual) {
        alert(log.length ? `✅ Restored: ${log.join(', ')}` : '⚠️ Nothing to restore');
      }
    } catch (e) {
      if (manual) alert('❌ Restore failed: ' + e.message);
    }
  }, [state.assetId]);

  useEffect(() => {
    fetch('/config').then(r => r.json()).then(cfg => {
      setConfig(prev => ({ ...prev, ...cfg }));
    }).catch(() => {});

    refreshStatus();
    restoreState(false);

    const interval = setInterval(refreshStatus, 10000);
    return () => clearInterval(interval);
  }, [refreshStatus, restoreState]);

  // ── Step Runners ───────────────────────────────────────────────────────────

  const runCheck = async () => {
    setStepState('check', true, null, null, 'Checking…');
    try {
      const [aliceStatus, aliceId, bobStatus, bobId] = await Promise.all([
        api('alice', '/api/v1/status'), api('alice', '/api/v1/node_id'),
        api('bob',   '/api/v1/status'), api('bob',   '/api/v1/node_id'),
      ]);
      updateState({ aliceNodeId: aliceId.data.node_id, bobNodeId: bobId.data.node_id });
      const result = { alice: { ...aliceStatus.data, node_id: aliceId.data.node_id }, bob: { ...bobStatus.data, node_id: bobId.data.node_id } };
      setStepState('check', false, 200, result, '✓ Done', 'success');
      markDone(0);
    } catch (e) {
      setStepState('check', false, 500, { error: e.message }, '✗ Error', 'danger');
      markError(0);
    }
  };

  const runGenesis = async () => {
    setStepState('mine-genesis', true, null, null, 'Mining…');
    try {
      await bitcoinAdmin('createwallet', ['demo']);
      const addr = await bitcoin('getnewaddress');
      const hashes = await bitcoin('generatetoaddress', [101, addr]);
      setStepState('mine-genesis', false, 200, { mined_blocks: hashes.length, tip: hashes[hashes.length - 1] }, '✓ Done', 'success');
      markDone(1);
      refreshStatus();
    } catch (e) {
      setStepState('mine-genesis', false, 500, { error: e.message }, '✗ Error', 'danger');
      markError(1);
    }
  };

  const runFundAlice = async () => {
    setStepState('fund-alice', true, null, null, 'Funding…');
    try {
      const addrResp = await api('alice', '/api/v1/wallet/new_address', 'POST', {});
      const addr = addrResp.data.address;
      updateState({ aliceWalletAddr: addr });
      await bitcoin('sendtoaddress', [addr, 1.0]);
      await bitcoin('generatetoaddress', [1, addr]);
      const syncResp = await api('alice', '/api/v1/wallet/sync', 'POST', {});
      const balResp = await api('alice', '/api/v1/balances');
      setStepState('fund-alice', false, 200, { address: addr, sync: syncResp.data, balance: balResp.data }, '✓ Done', 'success');
      markDone(2);
      refreshStatus();
    } catch (e) {
      setStepState('fund-alice', false, 500, { error: e.message }, '✗ Error', 'danger');
      markError(2);
    }
  };

  const runFundRgb = async () => {
    setStepState('fund-rgb', true, null, null, 'Funding…');
    try {
      const addrResp = await api('alice', '/api/v1/rgb/new_address', 'POST', {});
      const addr = addrResp.data.address;
      updateState({ aliceRgbAddr: addr });
      await bitcoin('sendtoaddress', [addr, 0.01]);
      await bitcoin('generatetoaddress', [1, addr]);
      await api('alice', '/api/v1/rgb/sync', 'POST', {});
      const utxos = await api('alice', '/api/v1/rgb/utxos');
      setStepState('fund-rgb', false, 200, { rgb_address: addr, utxos: utxos.data }, '✓ Done', 'success');
      markDone(3);
    } catch (e) {
      setStepState('fund-rgb', false, 500, { error: e.message }, '✗ Error', 'danger');
      markError(3);
    }
  };

  const runImportIssuer = async () => {
    setStepState('import-issuer', true, null, null, 'Importing…');
    try {
      const r = await fetch('/import-issuer', { method: 'POST' });
      const d = await r.json();
      if (r.ok) {
        setStepState('import-issuer', false, r.status, d, '✓ Done', 'success');
        markDone(4);
      } else {
        setStepState('import-issuer', false, r.status, d, '✗ Error', 'danger');
        markError(4);
      }
    } catch (e) {
      setStepState('import-issuer', false, 500, { error: e.message }, '✗ Error', 'danger');
      markError(4);
    }
  };

  const runIssue = async () => {
    setStepState('issue', true, null, null, 'Issuing…');
    try {
      await api('alice', '/api/v1/rgb/sync', 'POST', {});
      const r = await api('alice', '/api/v1/rgb/contracts/issue', 'POST', {
        issuer_name: config.issuerName,
        contract_name: 'TestToken',
        ticker: 'TTK',
        precision: 0,
        issued_supply: '1000000',
      });
      if (r.status === 200) {
        updateState({ contractId: r.data.contract_id, assetId: r.data.asset_id });
        setStepState('issue', false, 200, r.data, '✓ Done', 'success');
        markDone(5);
      } else {
        setStepState('issue', false, r.status, r.data, '✗ Error', 'danger');
        markError(5);
      }
    } catch (e) {
      setStepState('issue', false, 500, { error: e.message }, '✗ Error', 'danger');
      markError(5);
    }
  };

  const runShareContract = async () => {
    setStepState('share-contract', true, null, null, 'Exporting…');
    try {
      const r = await serverAction('/export-to-bob', { contractId: state.contractId });
      if (r.status === 200) {
        setStepState('share-contract', false, 200, r.data, '✓ Done', 'success');
        markDone(6);
      } else {
        setStepState('share-contract', false, r.status, r.data, '✗ Error', 'danger');
        markError(6);
      }
    } catch (e) {
      setStepState('share-contract', false, 500, { error: e.message }, '✗ Error', 'danger');
      markError(6);
    }
  };

  const runFundBob = async () => {
    setStepState('fund-bob', true, null, null, 'Funding…');
    try {
      const addrResp = await api('bob', '/api/v1/wallet/new_address', 'POST', {});
      const addr = addrResp.data.address;
      updateState({ bobWalletAddr: addr });
      await bitcoin('sendtoaddress', [addr, 0.05]);
      await bitcoin('generatetoaddress', [1, addr]);
      const syncResp = await api('bob', '/api/v1/wallet/sync', 'POST', {});
      const balResp = await api('bob', '/api/v1/balances');
      setStepState('fund-bob', false, 200, { address: addr, sync: syncResp.data, balance: balResp.data }, '✓ Done', 'success');
      markDone(7);
      refreshStatus();
    } catch (e) {
      setStepState('fund-bob', false, 500, { error: e.message }, '✗ Error', 'danger');
      markError(7);
    }
  };

  const runConnect = async () => {
    setStepState('connect', true, null, null, 'Connecting…');
    try {
      if (!state.bobNodeId) throw new Error('Run Step 1 first to get Bob node ID');
      const r = await api('alice', '/api/v1/peers/connect', 'POST', {
        node_id: state.bobNodeId,
        address: `${config.bobDockerIp}:9735`,
      });
      const peers = await api('alice', '/api/v1/peers');
      if (r.status === 200) {
        setStepState('connect', false, 200, { connect: r.data, peers: peers.data }, '✓ Done', 'success');
        markDone(8);
      } else {
        setStepState('connect', false, r.status, { connect: r.data, peers: peers.data }, '✗ Error', 'danger');
        markError(8);
      }
    } catch (e) {
      setStepState('connect', false, 500, { error: e.message }, '✗ Error', 'danger');
      markError(8);
    }
  };

  const runOpenChannel = async () => {
    setStepState('open-channel', true, null, null, 'Checking channels…');
    try {
      if (!state.assetId) throw new Error('Run Issue Contract step first');
      if (!state.bobNodeId) throw new Error('Run Check Nodes step first');

      // Check if a usable channel already exists — reuse only if ready AND usable
      const existingChans = await api('alice', '/api/v1/channels');
      const existing = existingChans.data?.length ? existingChans.data[0] : null;

      if (existing && existing.is_channel_ready && existing.is_usable) {
        updateState({
          userChannelId: existing.user_channel_id ?? state.userChannelId,
          channelId: existing.channel_id ?? state.channelId,
          assetId: existing.rgb_balance?.asset_id ?? state.assetId,
        });
        setStepState('open-channel', false, 200, {
          note: 'Channel already exists and is ready — reusing existing channel.',
          channel: existing,
        }, '✓ Done (existing)', 'success');
        markDone(9);
        return;
      }

      // Channel exists but is not ready/usable — surface this clearly, do not reuse
      if (existing && (!existing.is_channel_ready || !existing.is_usable)) {
        setStepState('open-channel', false, 409, {
          note: 'A channel exists but is NOT ready/usable yet. Run Step 11 (Confirm Channel) to mine blocks and wait for ChannelReady, then re-check here.',
          channel: existing,
          is_channel_ready: existing.is_channel_ready,
          is_usable: existing.is_usable,
        }, '⚠ Channel Pending', 'warn');
        markError(9);
        return;
      }

      // No existing channel: sync wallet then open a new one
      setStepState('open-channel', true, null, null, 'Syncing wallet…');
      const mineAddr = await bitcoin('getnewaddress');
      await bitcoin('generatetoaddress', [1, mineAddr]);
      await api('alice', '/api/v1/wallet/sync', 'POST', {});
      setStepState('open-channel', true, null, null, 'Opening channel…');

      const r = await api('alice', '/api/v1/channel/open', 'POST', {
        node_id: state.bobNodeId,
        address: `${config.bobDockerIp}:9735`,
        channel_amount_sats: '2000000',
        // Push initial BTC liquidity so Bob can pay the 10,000-sat hold invoice later.
        push_to_counterparty_msat: '50000000',
        rgb: {
          asset_id: state.assetId,
          asset_amount: '500000',
          color_context_data: `http://${config.aliceDockerIp}:8500/api/v1/rgb/consignments/{txid}?format=zip`,
        },
      });
      if (r.data.user_channel_id) updateState({ userChannelId: r.data.user_channel_id });
      if (r.status === 200) {
        setStepState('open-channel', false, 200, r.data, '✓ Done', 'success');
        markDone(9);
      } else {
        setStepState('open-channel', false, r.status, r.data, '✗ Error', 'danger');
        markError(9);
      }
    } catch (e) {
      setStepState('open-channel', false, 500, { error: e.message }, '✗ Error', 'danger');
      markError(9);
    }
  };

  const sleep = (ms) => new Promise(res => setTimeout(res, ms));

  const syncBothNodes = async () => {
    await Promise.all([
      api('alice', '/api/v1/wallet/sync', 'POST', {}).catch(() => null),
      api('bob',   '/api/v1/wallet/sync', 'POST', {}).catch(() => null),
    ]);
  };

  // Poll channel status until is_channel_ready, with retries and wallet syncs.
  const pollChannelReady = async (label, rounds = 3, blocksPerRound = 3, pollsPerRound = 12) => {
    const addr = await bitcoin('getnewaddress');
    for (let i = 0; i < rounds; i++) {
      setStepState('confirm-channel', true, null, null, `${label} — round ${i + 1}/${rounds}: mining ${blocksPerRound} blocks…`);
      await bitcoin('generatetoaddress', [blocksPerRound, addr]);

      setStepState('confirm-channel', true, null, null, `${label} — round ${i + 1}/${rounds}: syncing nodes…`);
      await syncBothNodes();
      await sleep(1500);

      setStepState('confirm-channel', true, null, null, `${label} — round ${i + 1}/${rounds}: waiting ChannelReady event…`);
      const evResp = await serverAction('/wait-event', { node: 'alice', eventType: 'ChannelReady', maxPolls: pollsPerRound });
      if (evResp.data?.found) return { via: 'event', data: evResp.data.found };

      // Event missed — check channel status directly
      setStepState('confirm-channel', true, null, null, `${label} — round ${i + 1}/${rounds}: checking channel status…`);
      await syncBothNodes();
      const chans = await api('alice', '/api/v1/channels');
      const ch = chans.data?.length ? chans.data[0] : null;
      if (ch?.is_channel_ready) return { via: 'status', channel: ch };
    }
    // Final status check after all rounds
    const chans = await api('alice', '/api/v1/channels');
    const ch = chans.data?.length ? chans.data[0] : null;
    if (ch?.is_channel_ready) return { via: 'status', channel: ch };
    return null;
  };

  const runConfirmChannel = async () => {
    setStepState('confirm-channel', true, null, null, 'Starting…');
    try {
      // First, check if channel is already ready (event may have been consumed earlier)
      await syncBothNodes();
      const existing = await api('alice', '/api/v1/channels');
      const existingCh = existing.data?.length ? existing.data[0] : null;
      if (existingCh?.is_channel_ready && existingCh?.is_usable) {
        updateState({ channelId: existingCh.channel_id, userChannelId: existingCh.user_channel_id });
        setStepState('confirm-channel', false, 200, {
          note: 'Channel already ready and usable — ChannelReady event was consumed in a previous run.',
          channel: existingCh,
        }, '✓ Channel Ready!', 'success');
        markDone(10);
        refreshStatus();
        return;
      }

      const result = await pollChannelReady('Confirming channel', 4, 3, 12);

      if (result) {
        const ch = result.channel || null;
        if (result.via === 'event') {
          updateState({ channelId: result.data?.data?.channel_id || ch?.channel_id || state.channelId });
        } else {
          updateState({ channelId: ch.channel_id, userChannelId: ch.user_channel_id });
        }
        const chanSnap = ch || (await api('alice', '/api/v1/channels')).data?.[0];
        setStepState('confirm-channel', false, 200, {
          note: result.via === 'event' ? 'ChannelReady event received.' : 'ChannelReady confirmed via channel status (event already consumed).',
          channel: chanSnap,
        }, '✓ Channel Ready!', 'success');
        markDone(10);
      } else {
        const chanSnap = (await api('alice', '/api/v1/channels')).data?.[0];
        setStepState('confirm-channel', false, 500, {
          error: 'Channel is still not ready after multiple mining rounds and sync attempts.',
          hint: 'Possible causes: (1) Docker containers lost connectivity — restart with docker-compose restart; (2) Channel opening tx was rejected — re-run Step 10; (3) rgbldkd node is stalled — check container logs.',
          channel: chanSnap,
        }, '✗ Channel not ready', 'danger');
        markError(10);
      }
      refreshStatus();
    } catch (e) {
      setStepState('confirm-channel', false, 500, { error: e.message }, '✗ Error', 'danger');
      markError(10);
    }
  };

  const runRgbLnPay = async () => {
    setStepState('rgb-ln-pay', true, null, null, 'Paying…');
    try {
      if (!state.assetId) throw new Error('Issue contract first');
      const invResp = await api('bob', '/api/v1/rgb/ln/invoice/create', 'POST', {
        asset_id: state.assetId,
        asset_amount: '100',
        description: 'buy 100 TTK on rgbs.fun',
        expiry_secs: 3600,
        btc_carrier_amount_msat: '3000000',
      });
      if (invResp.status !== 200) throw new Error('Bob invoice creation failed: ' + JSON.stringify(invResp.data));
      const invoice = invResp.data.invoice;
      const payResp = await api('alice', '/api/v1/rgb/ln/pay', 'POST', { invoice });
      const evResp = await serverAction('/wait-event', { node: 'alice', eventType: 'PaymentSuccessful', maxPolls: 10 });
      const chansAlice = await api('alice', '/api/v1/channels');

      setStepState('rgb-ln-pay', false, 200, {
        invoice: invoice.slice(0, 40) + '…',
        payment: payResp.data,
        event: evResp.data.found,
        channels_alice: chansAlice.data,
      }, '✓ 100 TTK Sent!', 'success');
      markDone(11);
    } catch (e) {
      setStepState('rgb-ln-pay', false, 500, { error: e.message }, '✗ Error', 'danger');
      markError(11);
    }
  };

  const runSwapFundBob = async () => {
    setStepState('hold-swap', true, null, null, 'Funding…');
    try {
      const addrResp = await api('bob', '/api/v1/wallet/new_address', 'POST', {});
      const bobAddr = addrResp.data.address;
      await bitcoin('sendtoaddress', [bobAddr, 0.05]);
      const mineAddr = await bitcoin('getnewaddress');
      await bitcoin('generatetoaddress', [1, mineAddr]);
      await api('bob', '/api/v1/wallet/sync', 'POST', {});
      const balResp = await api('bob', '/api/v1/balances');

      setStepState('hold-swap', false, 200, {
        step: '⓪ Fund Bob 0.05 BTC',
        bob_address: bobAddr,
        bob_balance: balResp.data.btc,
        note: 'On-chain confirmed. LN outbound capacity = 30,000 sats (50k pushed − 20k reserve). Enough to pay the 10,000-sat hold invoice.',
      }, '✓ ⓪ Bob Funded', 'success');
      setSwapUnlocked(prev => ({ ...prev, 1: true }));
      refreshStatus();
    } catch (e) {
      setStepState('hold-swap', false, 500, { error: e.message }, '✗ Error', 'danger');
    }
  };

  const runSwapStep1 = async () => {
    setStepState('hold-swap', true, null, null, 'Creating…');
    try {
      const preimage = randHex(32);
      const paymentHash = await sha256hex(preimage);

      const r = await api('alice', '/api/v1/bolt11/receive_for_hash', 'POST', {
        payment_hash: paymentHash,
        amount_msat: '10000000',
        description: 'swap: 10000 sats for 200 TTK',
        expiry_secs: HTLC_EXPIRY_MS / 1000,
      });
      if (r.status !== 200) throw new Error('Hold invoice creation failed: ' + JSON.stringify(r.data));

      // Persist preimage AFTER the node confirms the invoice — if the node call
      // fails, we never save a preimage for a non-existent invoice.
      // holdInvoice is also saved so step② can continue after a page refresh.
      saveSwapToSession(preimage, paymentHash, r.data.invoice);
      updateState({ swapPreimage: preimage, swapPaymentHash: paymentHash, holdInvoice: r.data.invoice });

      setStepState('hold-swap', false, 200, {
        step: '① Alice creates hold invoice',
        preimage,
        payment_hash: paymentHash,
        invoice: r.data,
        note: `Invoice valid for ${HTLC_EXPIRY_MS / 60000} min. Preimage saved to sessionStorage — survives page refresh.`,
      }, '✓ ① Done', 'success');
      setSwapUnlocked(prev => ({ ...prev, 2: true }));
    } catch (e) {
      setStepState('hold-swap', false, 500, { error: e.message }, '✗ Error', 'danger');
    }
  };

  const runSwapStep2 = async () => {
    setStepState('hold-swap', true, null, null, 'Bob paying…');
    try {
      if (!state.holdInvoice) throw new Error('Run ① first to create the hold invoice');
      const holdInvoiceAmountMsat = 10_000_000;

      // Check Bob's channel is usable before attempting payment
      const bobChans = await api('bob', '/api/v1/channels');
      const bobChan = bobChans.data?.length ? bobChans.data[0] : null;
      if (bobChan && !bobChan.is_usable) {
        throw new Error(
          `Channel not usable yet (is_usable: false). ` +
          `Try re-running Step 11 to mine more blocks, or wait a few seconds and retry.`
        );
      }
      if (bobChan) {
        const outboundMsat = Number(bobChan.outbound_capacity_msat || 0);
        if (outboundMsat < holdInvoiceAmountMsat) {
          throw new Error(
            `Insufficient Bob outbound liquidity for hold invoice. ` +
            `Required: ${holdInvoiceAmountMsat} msat (10000 sats), available: ${outboundMsat} msat (${Math.floor(outboundMsat / 1000)} sats). ` +
            `Channel can be ready/usable but still cannot route this payment. ` +
            `Open a fresh channel with pushed liquidity (Step 10 now pushes 50,000 sats to Bob) and retry from Step 11.`
          );
        }
      }

      const r = await api('bob', '/api/v1/bolt11/send', 'POST', { invoice: state.holdInvoice });
      if (r.status !== 200) {
        setStepState('hold-swap', false, r.status, {
          step: '② Bob pays BTC hold invoice',
          result: r.data,
          hint: r.data?.error === 'PaymentSendingFailed'
            ? 'Payment failed. Possible causes: (1) invoice expired — re-run ① to create a new one; (2) channel not usable — re-run Step 11.'
            : undefined,
        }, '✗ Error', 'danger');
        return;
      }

      setStepState('hold-swap', false, 200, {
        step: '② Bob pays BTC hold invoice (HTLC locked)',
        result: r.data,
        note: 'HTLC is LOCKED — Alice has not settled yet. Bob cannot cancel.',
      }, '✓ ② BTC Locked', 'success');
      setSwapUnlocked(prev => ({ ...prev, 3: true }));
    } catch (e) {
      setStepState('hold-swap', false, 500, { error: e.message }, '✗ Error', 'danger');
    }
  };

  const runSwapStep3 = async () => {
    setStepState('hold-swap', true, null, null, 'Sending RGB…');
    try {
      if (!state.assetId) throw new Error('Issue contract first');

      // Safety guard: refuse to send TTK if the HTLC is about to expire.
      // If we send TTK now but can't claim BTC before expiry, Alice loses TTK for free.
      const remainingMs = getRemainingHtlcMs();
      if (remainingMs < HTLC_SAFETY_MS) {
        const remainingSec = Math.floor(remainingMs / 1000);
        throw new Error(
          `HTLC expires in ${remainingSec}s (< ${HTLC_SAFETY_MS / 1000}s safety margin). ` +
          `Sending TTK now risks Alice losing assets. ` +
          `Let this HTLC timeout so Bob's BTC is refunded, then re-run ① to start fresh.`
        );
      }

      const invResp = await api('bob', '/api/v1/rgb/ln/invoice/create', 'POST', {
        asset_id: state.assetId,
        asset_amount: '200',
        description: 'swap receive TTK',
        expiry_secs: 3600,
        btc_carrier_amount_msat: '1000000',
      });
      const payResp = await api('alice', '/api/v1/rgb/ln/pay', 'POST', { invoice: invResp.data.invoice });
      updateState({ rgbPaymentId: payResp.data.payment_id });
      const evResp = await serverAction('/wait-event', { node: 'alice', eventType: 'PaymentSuccessful', maxPolls: 8 });

      // Critical check: if the PaymentSuccessful event wasn't received (found=null),
      // the RGB payment may not have completed. Proceeding to step④ (claim BTC) in this
      // state would mean Alice claims BTC while Bob may not have received the TTK.
      if (!evResp.data?.found) {
        throw new Error(
          'RGB payment confirmation timed out — PaymentSuccessful event not received. ' +
          'Check Alice\'s channel balance to verify whether Bob received the TTK before retrying. ' +
          'Do NOT claim BTC until the RGB transfer is confirmed.'
        );
      }

      // Persist step③ completion so the Exit Scam guard in step④ survives a page refresh.
      markSwapStep3Complete();

      setStepState('hold-swap', false, 200, {
        step: '③ Alice sends 200 TTK to Bob via RGB LN',
        rgb_invoice: invResp.data.invoice.slice(0, 40) + '…',
        payment: payResp.data,
        event: evResp.data.found,
        note: 'RGB transfer confirmed. Now safe to claim BTC.',
      }, '✓ ③ RGB Sent', 'success');
      setSwapUnlocked(prev => ({ ...prev, 4: true }));
    } catch (e) {
      setStepState('hold-swap', false, 500, { error: e.message }, '✗ Error', 'danger');
    }
  };

  const runSwapStep4 = async () => {
    setStepState('hold-swap', true, null, null, 'Claiming BTC…');
    try {
      // Guard: enforce that step③ RGB payment completed before claiming BTC.
      // swapUnlocked[4] is only set to true inside runSwapStep3 after PaymentSuccessful
      // event is confirmed — this prevents Alice from skipping TTK delivery.
      if (!swapUnlocked[4]) {
        throw new Error(
          'Step③ (Alice sends RGB TTK) must complete successfully before claiming BTC. ' +
          'Run ③ first to ensure Bob has received the tokens.'
        );
      }

      if (!state.swapPreimage || !state.swapPaymentHash) {
        throw new Error('Preimage not found. If you refreshed the page, the preimage may have expired. Re-run ① to start a new swap.');
      }

      const r = await api('alice', '/api/v1/bolt11/claim_for_hash', 'POST', {
        payment_hash: state.swapPaymentHash,
        preimage: state.swapPreimage,
        claimable_amount_msat: '10000000',
      });
      const aliceBal = await api('alice', '/api/v1/balances');
      const bobBal = await api('bob', '/api/v1/balances');

      if (r.status === 200) {
        // Clear persisted preimage only after a confirmed successful claim.
        clearSwapSession();
        setStepState('hold-swap', false, 200, {
          step: '④ Alice claims BTC by revealing preimage — SWAP COMPLETE',
          claim: r.data,
          alice_balance: aliceBal.data,
          bob_balance: bobBal.data,
          summary: { alice: '+10000 sats, -200 TTK', bob: '-10000 sats, +200 TTK' },
        }, '✓ ④ SWAP COMPLETE!', 'success');
        markDone(12);
      } else {
        // Claim failed — preimage is preserved in sessionStorage for retry.
        setStepState('hold-swap', false, r.status, {
          step: '④ Claim BTC failed',
          claim: r.data,
          note: 'Preimage preserved in sessionStorage — retry step④ if HTLC has not expired.',
        }, '✗ Claim Failed — Retry ④', 'danger');
        markError(12);
      }
    } catch (e) {
      setStepState('hold-swap', false, 500, { error: e.message }, '✗ Error', 'danger');
    }
  };

  const steps = getSteps(config, state);
  const currentStepData = steps[currentStep];
  const currentStepState = stepStates[currentStepData.id] || {};

  const getRunHandler = (id) => {
    const handlers = {
      'check': runCheck,
      'mine-genesis': runGenesis,
      'fund-alice': runFundAlice,
      'fund-rgb': runFundRgb,
      'import-issuer': runImportIssuer,
      'issue': runIssue,
      'share-contract': runShareContract,
      'fund-bob': runFundBob,
      'connect': runConnect,
      'open-channel': runOpenChannel,
      'confirm-channel': runConfirmChannel,
      'rgb-ln-pay': runRgbLnPay,
    };
    return handlers[id];
  };

  return (
    <AppContext.Provider value={{
      config, state, nodeStatus, currentStep, setCurrentStep,
      stepDone, stepError, updateState, restoreState
    }}>
      <Sidebar steps={steps} />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-bg">
        <StatusBar />

        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-4xl mx-auto">
            {currentStepData.render()}

            {currentStepData.id === 'hold-swap' ? (
              <div className="flex flex-wrap gap-2 mt-4 items-center">
                <Button variant="secondary" onClick={runSwapFundBob} loading={currentStepState.loading && currentStepState.btnText === 'Funding…'}>
                  {currentStepState.btnText === '✓ ⓪ Bob Funded' ? '✓ ⓪ Bob Funded' : '⓪ Fund Bob 0.05 BTC'}
                </Button>
                <Button variant="secondary" onClick={runSwapStep1} disabled={!swapUnlocked[1]} loading={currentStepState.loading && currentStepState.btnText === 'Creating…'}>
                  {currentStepState.btnText === '✓ ① Done' ? '✓ ① Done' : '① Create Hold Invoice'}
                </Button>
                <Button variant="secondary" onClick={runSwapStep2} disabled={!swapUnlocked[2]} loading={currentStepState.loading && currentStepState.btnText === 'Bob paying…'}>
                  {currentStepState.btnText === '✓ ② BTC Locked' ? '✓ ② BTC Locked' : '② Bob Pay BTC'}
                </Button>
                <Button variant="secondary" onClick={runSwapStep3} disabled={!swapUnlocked[3]} loading={currentStepState.loading && currentStepState.btnText === 'Sending RGB…'}>
                  {currentStepState.btnText === '✓ ③ RGB Sent' ? '✓ ③ RGB Sent' : '③ Alice Send RGB'}
                </Button>
                <Button variant="success" onClick={runSwapStep4} disabled={!swapUnlocked[4]} loading={currentStepState.loading && currentStepState.btnText === 'Claiming BTC…'}>
                  {currentStepState.btnText === '✓ ④ SWAP COMPLETE!' ? '✓ ④ SWAP COMPLETE!' : '④ Claim BTC'}
                </Button>
              </div>
            ) : (
              <div className="mt-4">
                <Button
                  onClick={getRunHandler(currentStepData.id)}
                  loading={currentStepState.loading}
                  variant={currentStepState.btnVariant}
                >
                  {currentStepState.btnText || `▶ Run ${currentStepData.label}`}
                </Button>
              </div>
            )}

            <ResponsePanel
              visible={!!currentStepState.data || currentStepState.status === 500}
              status={currentStepState.status}
              data={currentStepState.data}
            />
          </div>
        </div>

        <StatePanel />
      </div>
    </AppContext.Provider>
  );
}
