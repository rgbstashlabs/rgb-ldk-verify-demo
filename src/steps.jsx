import React from 'react';
import { ApiBlock, InfoBox } from './components/UI';

export const getSteps = (config, state) => [
  // ── Phase A: Infrastructure ──────────────────────────────────────────────
  {
    id: 'check', icon: '🔍', label: 'Check Nodes', phase: 'infra',
    render: () => (
      <>
        <div className="mb-5">
          <h2 className="text-lg font-semibold flex items-center gap-2.5">
            <span>🔍</span> Check Nodes 
            <span className="text-[10px] px-2 py-0.5 rounded-full font-bold tracking-wide bg-[#1c2433] text-blue">INFRA</span>
          </h2>
          <p className="text-muted mt-1.5 text-[13px] leading-relaxed">
            Verify both rgbldkd nodes are running and retrieve their Node IDs for subsequent steps.
          </p>
        </div>
        <ApiBlock method="GET" path="/api/v1/status" nodeLabel="alice & bob">
          /api/v1/node_id
        </ApiBlock>
      </>
    )
  },
  {
    id: 'mine-genesis', icon: '⛏️', label: 'Mine 101 Blocks', phase: 'infra',
    render: () => (
      <>
        <div className="mb-5">
          <h2 className="text-lg font-semibold flex items-center gap-2.5">
            <span>⛏️</span> Mine Genesis Blocks 
            <span className="text-[10px] px-2 py-0.5 rounded-full font-bold tracking-wide bg-[#1c2433] text-blue">INFRA</span>
          </h2>
          <p className="text-muted mt-1.5 text-[13px] leading-relaxed">
            Mine 101 blocks to activate coinbase maturity so that subsequent funding operations can spend those outputs.
          </p>
        </div>
        <InfoBox type="tip">💡 In bitcoind regtest, coinbase outputs require 100 block confirmations before they can be spent, so 101 blocks must be mined initially.</InfoBox>
        <ApiBlock method="RPC" path="generatetoaddress 101 <address>" nodeLabel="bitcoind" />
      </>
    )
  },
  {
    id: 'fund-alice', icon: '💰', label: 'Fund Alice BTC', phase: 'infra',
    render: () => (
      <>
        <div className="mb-5">
          <h2 className="text-lg font-semibold flex items-center gap-2.5">
            <span>💰</span> Fund Alice BTC Wallet 
            <span className="text-[10px] px-2 py-0.5 rounded-full font-bold tracking-wide bg-[#1c2433] text-blue">INFRA</span>
          </h2>
          <p className="text-muted mt-1.5 text-[13px] leading-relaxed">
            Get Alice's on-chain BTC address, send 1 BTC to it, and sync the wallet. This BTC will be used to open a Lightning channel.
          </p>
        </div>
        <ApiBlock method="POST" path="/api/v1/wallet/new_address" nodeLabel="alice" />
        <ApiBlock method="RPC" path="sendtoaddress <alice_addr> 1.0" nodeLabel="bitcoind" />
        <ApiBlock method="POST" path="/api/v1/wallet/sync" nodeLabel="alice" />
      </>
    )
  },
  {
    id: 'fund-rgb', icon: '🎨', label: 'Fund Alice RGB UTXO', phase: 'infra',
    render: () => (
      <>
        <div className="mb-5">
          <h2 className="text-lg font-semibold flex items-center gap-2.5">
            <span>🎨</span> Fund Alice RGB UTXO 
            <span className="text-[10px] px-2 py-0.5 rounded-full font-bold tracking-wide bg-[#1c2433] text-blue">INFRA</span>
          </h2>
          <p className="text-muted mt-1.5 text-[13px] leading-relaxed">
            Issuing an RGB contract requires consuming a Bitcoin UTXO as a seal. Fund Alice's RGB wallet address with a small amount of BTC to create a spendable UTXO.
          </p>
        </div>
        <InfoBox type="warn">⚠️ Each RGB transfer consumes one UTXO — this is a fundamental protocol constraint (single-use seal).</InfoBox>
        <ApiBlock method="POST" path="/api/v1/rgb/new_address" nodeLabel="alice" />
      </>
    )
  },

  // ── Phase B: RGB Contract ─────────────────────────────────────────────────
  {
    id: 'import-issuer', icon: '📦', label: 'Import Issuer Template', phase: 'rgb',
    render: () => (
      <>
        <div className="mb-5">
          <h2 className="text-lg font-semibold flex items-center gap-2.5">
            <span>📦</span> Import RGB Issuer Template 
            <span className="text-[10px] px-2 py-0.5 rounded-full font-bold tracking-wide bg-[#1c2d1c] text-green">RGB</span>
          </h2>
          <p className="text-muted mt-1.5 text-[13px] leading-relaxed">
            Import the RGB20-Simplest issuer template (binary .issuer file) into Alice's node. This is required before issuing a new RGB20 contract.
          </p>
        </div>
        <ApiBlock method="POST" path="/api/v1/rgb/issuers/import?name=RGB20-Simplest-v0-rLosfg&format=raw" nodeLabel="alice">
          Body: &lt;binary .issuer file&gt; (served by proxy from local filesystem)
        </ApiBlock>
      </>
    )
  },
  {
    id: 'issue', icon: '🪙', label: 'Issue RGB20 Contract', phase: 'rgb',
    render: () => (
      <>
        <div className="mb-5">
          <h2 className="text-lg font-semibold flex items-center gap-2.5">
            <span>🪙</span> Issue RGB20 Contract 
            <span className="text-[10px] px-2 py-0.5 rounded-full font-bold tracking-wide bg-[#1c2d1c] text-green">RGB</span>
          </h2>
          <p className="text-muted mt-1.5 text-[13px] leading-relaxed">
            Issue an RGB20 token contract on Alice's node (TestToken, supply 1,000,000).
          </p>
        </div>
        <ApiBlock method="POST" path="/api/v1/rgb/contracts/issue" nodeLabel="alice">
          {JSON.stringify({ issuer_name: config.issuerName, contract_name: 'TestToken', ticker: 'TTK', precision: 0, issued_supply: '1000000' }, null, 2)}
        </ApiBlock>
      </>
    )
  },
  {
    id: 'share-contract', icon: '📤', label: 'Share Contract → Bob', phase: 'rgb',
    render: () => (
      <>
        <div className="mb-5">
          <h2 className="text-lg font-semibold flex items-center gap-2.5">
            <span>📤</span> Share Contract with Bob 
            <span className="text-[10px] px-2 py-0.5 rounded-full font-bold tracking-wide bg-[#1c2d1c] text-green">RGB</span>
          </h2>
          <p className="text-muted mt-1.5 text-[13px] leading-relaxed">
            Export the contract consignment from Alice and import it into Bob's node. The proxy server handles the export → download → import pipeline in the background.
          </p>
        </div>
        <ApiBlock method="POST" path="/api/v1/rgb/contracts/export" nodeLabel="alice">
          → get consignment_key
        </ApiBlock>
        <ApiBlock method="GET" path="/api/v1/rgb/consignments/{key}?format=zip" nodeLabel="alice">
          → download consignment binary (zip format)
        </ApiBlock>
        <ApiBlock method="POST" path="/api/v1/rgb/contracts/import?contract_id=...&format=zip" nodeLabel="bob">
          Body: &lt;consignment binary&gt;
        </ApiBlock>
      </>
    )
  },

  // ── Phase C: Lightning Channel ────────────────────────────────────────────
  {
    id: 'fund-bob', icon: '💵', label: 'Fund Bob BTC', phase: 'ln',
    render: () => (
      <>
        <div className="mb-5">
          <h2 className="text-lg font-semibold flex items-center gap-2.5">
            <span>💵</span> Fund Bob BTC Wallet 
            <span className="text-[10px] px-2 py-0.5 rounded-full font-bold tracking-wide bg-[#2d1c2d] text-purple">LN</span>
          </h2>
          <p className="text-muted mt-1.5 text-[13px] leading-relaxed">
            Bob needs BTC to pay Alice in the Hold Invoice atomic swap step. Fund Bob's wallet with 0.05 BTC in advance.
          </p>
        </div>
        <ApiBlock method="POST" path="/api/v1/wallet/new_address" nodeLabel="bob" />
      </>
    )
  },
  {
    id: 'connect', icon: '🔗', label: 'Connect Peers', phase: 'ln',
    render: () => (
      <>
        <div className="mb-5">
          <h2 className="text-lg font-semibold flex items-center gap-2.5">
            <span>🔗</span> Connect Peers 
            <span className="text-[10px] px-2 py-0.5 rounded-full font-bold tracking-wide bg-[#2d1c2d] text-purple">LN</span>
          </h2>
          <p className="text-muted mt-1.5 text-[13px] leading-relaxed">
            Connect Alice to Bob's P2P endpoint (Docker internal IP). This is required before opening a Lightning channel.
          </p>
        </div>
        <InfoBox type="tip">💡 Alice and Bob share the same Docker network and communicate via internal IP {config.bobDockerIp}.</InfoBox>
        <ApiBlock method="POST" path="/api/v1/peers/connect" nodeLabel="alice">
          {JSON.stringify({ node_id: '<bob_node_id>', address: `${config.bobDockerIp}:9735` }, null, 2)}
        </ApiBlock>
      </>
    )
  },
  {
    id: 'open-channel', icon: '⚡', label: 'Open RGB LN Channel', phase: 'ln',
    render: () => (
      <>
        <div className="mb-5">
          <h2 className="text-lg font-semibold flex items-center gap-2.5">
            <span>⚡</span> Open RGB LN Channel 
            <span className="text-[10px] px-2 py-0.5 rounded-full font-bold tracking-wide bg-[#2d1c2d] text-purple">LN</span>
          </h2>
          <p className="text-muted mt-1.5 text-[13px] leading-relaxed">
            Alice opens a Lightning channel to Bob carrying both BTC and RGB tokens. The <code>rgb_context</code> URL is the endpoint Bob uses to download the consignment (Alice's Docker internal address).
          </p>
        </div>
        <ApiBlock method="POST" path="/api/v1/channel/open" nodeLabel="alice">
          {JSON.stringify({ 
            node_id: '<bob_node_id>', 
            address: `${config.bobDockerIp}:9735`, 
            channel_amount_sats: '2000000', 
            rgb: { 
              asset_id: '<asset_id>', 
              asset_amount: '500000', 
              color_context_data: `http://${config.aliceDockerIp}:8500/api/v1/rgb/consignments/{txid}?format=zip` 
            } 
          }, null, 2)}
        </ApiBlock>
        <InfoBox type="warn">⚠️ After opening the channel, mine 6 blocks to confirm it, then wait for the ChannelReady event. The next step handles this.</InfoBox>
      </>
    )
  },
  {
    id: 'confirm-channel', icon: '🧱', label: 'Confirm Channel', phase: 'ln',
    render: () => (
      <>
        <div className="mb-5">
          <h2 className="text-lg font-semibold flex items-center gap-2.5">
            <span>🧱</span> Confirm Channel (Mine + Wait Event) 
            <span className="text-[10px] px-2 py-0.5 rounded-full font-bold tracking-wide bg-[#2d1c2d] text-purple">LN</span>
          </h2>
          <p className="text-muted mt-1.5 text-[13px] leading-relaxed">
            Mine 6 blocks to confirm the channel funding transaction, then poll Alice's event queue until a <code>ChannelReady</code> event is received.
          </p>
        </div>
        <InfoBox type="tip">💡 This step demonstrates rgbldkd's event-driven model: <code>events/wait_next</code> long-poll → handle event → <code>events/handled</code> ACK.</InfoBox>
        <ApiBlock method="RPC" path="generatetoaddress 6 <addr>" nodeLabel="bitcoind" />
        <ApiBlock method="POST" path="/api/v1/events/wait_next → events/handled" nodeLabel="alice (via proxy)">
          Polls until ChannelReady event is received and ACK'd
        </ApiBlock>
      </>
    )
  },

  // ── Phase D: Payments ─────────────────────────────────────────────────────
  {
    id: 'rgb-ln-pay', icon: '💸', label: 'RGB LN Payment', phase: 'ln',
    render: () => (
      <>
        <div className="mb-5">
          <h2 className="text-lg font-semibold flex items-center gap-2.5">
            <span>💸</span> RGB LN Payment (Alice → Bob) 
            <span className="text-[10px] px-2 py-0.5 rounded-full font-bold tracking-wide bg-[#2d1c2d] text-purple">LN</span>
          </h2>
          <p className="text-muted mt-1.5 text-[13px] leading-relaxed">
            Bob creates an RGB LN invoice requesting 100 TTK, and Alice pays it. This demonstrates instant RGB token transfer inside a Lightning channel.
          </p>
        </div>
        <ApiBlock method="POST" path="/api/v1/rgb/ln/invoice/create" nodeLabel="bob (receiver)">
          {JSON.stringify({ asset_id: '<asset_id>', asset_amount: '100', description: 'buy 100 TTK', expiry_secs: 3600, btc_carrier_amount_msat: '3000000' }, null, 2)}
        </ApiBlock>
        <ApiBlock method="POST" path="/api/v1/rgb/ln/pay" nodeLabel="alice (sender)">
          {JSON.stringify({ invoice: '<bob_rgb_invoice>' }, null, 2)}
        </ApiBlock>
      </>
    )
  },
  {
    id: 'hold-swap', icon: '🔐', label: 'Hold Invoice Swap', phase: 'swap',
    render: () => (
      <>
        <div className="mb-5">
          <h2 className="text-lg font-semibold flex items-center gap-2.5">
            <span>🔐</span> Hold Invoice Atomic Swap 
            <span className="text-[10px] px-2 py-0.5 rounded-full font-bold tracking-wide bg-[#2d2210] text-orange">SWAP</span>
          </h2>
          <p className="text-muted mt-1.5 text-[13px] leading-relaxed">
            Simulates an AMM swap: Bob wants to exchange BTC for Alice's TTK. Uses Hold Invoice to achieve a near-atomic two-step flow:<br />
            <strong>① Alice creates a BTC Hold Invoice → ② Bob pays BTC (HTLC lock) → ③ Alice sends RGB tokens → ④ Alice claims BTC</strong>
          </p>
        </div>
        <InfoBox type="warn">⚠️ Hold Invoice = HTLC lock (not settled immediately). Alice releases the HTLC after confirming the RGB transfer succeeded; otherwise Bob is refunded.</InfoBox>
        <ApiBlock method="POST" path="/api/v1/bolt11/receive_for_hash" nodeLabel="alice — create Hold Invoice">
          {JSON.stringify({ payment_hash: '<sha256(preimage)>', amount_msat: '10000000', description: 'swap: 10000 sats for 200 TTK', expiry_secs: 600 }, null, 2)}
        </ApiBlock>
        <ApiBlock method="POST" path="/api/v1/bolt11/send" nodeLabel="bob — pay BTC (HTLC lock)">
          {JSON.stringify({ invoice: '<alice_hold_invoice>' }, null, 2)}
        </ApiBlock>
        <ApiBlock method="POST" path="/api/v1/rgb/ln/invoice/create + rgb/ln/pay" nodeLabel="bob→alice: create invoice / alice: send RGB" />
        <ApiBlock method="POST" path="/api/v1/bolt11/claim_for_hash" nodeLabel="alice — release HTLC, receive BTC">
          {JSON.stringify({ payment_hash: '<payment_hash>', preimage: '<random_preimage>', claimable_amount_msat: '10000000' }, null, 2)}
        </ApiBlock>
        <InfoBox>💡 Bob needs sufficient on-chain BTC to pay Alice's Hold Invoice through the channel. Use step ⓪ to fund Bob with 0.05 BTC first.</InfoBox>
      </>
    )
  }
];
