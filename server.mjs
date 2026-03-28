/**
 * RGB-LDK Integration Demo Proxy Server
 *
 * Resolves CORS and binary data issues when calling rgbldkd HTTP API from browser.
 *
 * Routes:
 *   GET  /                → serves index.html
 *   GET  /config          → returns node config (docker IPs, etc.)
 *   ANY  /alice/*         → proxy to localhost:8500/*
 *   ANY  /bob/*           → proxy to localhost:8501/*
 *   POST /bitcoin         → proxy to bitcoind RPC (localhost:18443)
 *   POST /import-issuer   → reads .issuer binary file and POSTs to alice
 *   POST /export-to-bob   → alice export → download consignment → bob import (all server-side)
 *   POST /wait-event      → polls events on a node until target event type is found
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Configuration ────────────────────────────────────────────────────────────

const ALICE_URL       = 'http://localhost:8500';
const BOB_URL         = 'http://localhost:8501';
const BTC_RPC_URL     = 'http://localhost:18443';
const BTC_AUTH        = Buffer.from('btcuser:btcpass').toString('base64');
const BTC_WALLET      = 'demo';
const ALICE_DOCKER_IP = '172.18.0.4'; // alice's IP inside docker network (bob uses this to reach alice)
const BOB_DOCKER_IP   = '172.18.0.5';
const ALICE_P2P_PORT  = 9735;         // alice P2P port inside docker

const ISSUER_FILE = path.resolve(
  __dirname,
  'RGB20-Simplest-v0-rLosfg.issuer',
);
const ISSUER_NAME = 'RGB20-Simplest-v0-rLosfg';

const PORT = 3000;

// ── HTTP helpers ─────────────────────────────────────────────────────────────

function readBody(req) {
  return new Promise(resolve => {
    const bufs = [];
    req.on('data', c => bufs.push(c));
    req.on('end', () => resolve(Buffer.concat(bufs)));
  });
}

function httpReq(urlStr, { method = 'GET', headers = {}, body = null, timeoutMs = 90000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const req = http.request(
      {
        hostname: u.hostname,
        port: parseInt(u.port) || 80,
        path: u.pathname + u.search,
        method,
        headers,
        timeout: timeoutMs,
      },
      res => {
        const bufs = [];
        res.on('data', c => bufs.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(bufs) }),
        );
      },
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`HTTP request timed out after ${timeoutMs}ms: ${method} ${urlStr}`));
    });
    if (body) req.write(body);
    req.end();
  });
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function jsonResp(res, status, data) {
  setCors(res);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data, null, 2));
}

async function proxyToNode(baseUrl, req, res) {
  const url = new URL(req.url, 'http://x');
  // Strip prefix: /alice/api/v1/... → /api/v1/...
  const prefix = url.pathname.startsWith('/alice/') ? '/alice' : '/bob';
  const targetPath = url.pathname.slice(prefix.length) + url.search;

  const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : null;
  const ct   = req.headers['content-type'] || 'application/json';

  const result = await httpReq(baseUrl + targetPath, {
    method: req.method,
    headers: { 'Content-Type': ct },
    body,
    timeoutMs: 120000, // 2 min for long-polling events
  });

  setCors(res);
  res.writeHead(result.status, {
    'Content-Type': result.headers['content-type'] || 'application/json',
  });
  res.end(result.body);
}

// ── Main request handler ─────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p   = url.pathname;

  try {
    // ── Static ──────────────────────────────────────────────────────────────

    if (p === '/' || p === '/index.html') {
      const html = fs.readFileSync(path.join(__dirname, 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    if (p === '/config') {
      jsonResp(res, 200, {
        aliceDockerIp: ALICE_DOCKER_IP,
        bobDockerIp:   BOB_DOCKER_IP,
        aliceP2pPort:  ALICE_P2P_PORT,
        issuerName:    ISSUER_NAME,
      });
      return;
    }

    // ── Node API Proxies ─────────────────────────────────────────────────────

    if (p.startsWith('/alice/')) { await proxyToNode(ALICE_URL, req, res); return; }
    if (p.startsWith('/bob/'))   { await proxyToNode(BOB_URL, req, res);   return; }

    // ── Bitcoind RPC ─────────────────────────────────────────────────────────

    if (p === '/bitcoin' && req.method === 'POST') {
      const body = await readBody(req);
      // ?wallet=<name>  → use named wallet
      // ?wallet=        → no wallet path (for admin calls like createwallet, getblockchaininfo)
      // (no param)      → use default BTC_WALLET
      const walletName = url.searchParams.has('wallet')
        ? url.searchParams.get('wallet')   // may be empty string → no wallet path
        : BTC_WALLET;
      const walletPath = walletName ? `/wallet/${walletName}` : '';
      const result     = await httpReq(BTC_RPC_URL + walletPath, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Basic ${BTC_AUTH}` },
        body,
      });
      setCors(res);
      res.writeHead(result.status, { 'Content-Type': 'application/json' });
      res.end(result.body);
      return;
    }

    // ── Import Issuer (binary file → alice) ──────────────────────────────────

    if (p === '/import-issuer' && req.method === 'POST') {
      if (!fs.existsSync(ISSUER_FILE)) {
        jsonResp(res, 404, { error: `Issuer file not found: ${ISSUER_FILE}` });
        return;
      }
      const issuerData = fs.readFileSync(ISSUER_FILE);
      console.log(`[import-issuer] Uploading ${issuerData.length} bytes → alice`);
      const result = await httpReq(
        `${ALICE_URL}/api/v1/rgb/issuers/import?name=${encodeURIComponent(ISSUER_NAME)}&format=raw`,
        { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: issuerData },
      );
      setCors(res);
      res.writeHead(result.status, { 'Content-Type': 'application/json' });
      res.end(result.body);
      return;
    }

    // ── Export Contract from Alice → Import to Bob ───────────────────────────

    if (p === '/export-to-bob' && req.method === 'POST') {
      const { contractId } = JSON.parse((await readBody(req)).toString());
      console.log(`[export-to-bob] contract_id=${contractId}`);

      // 1. Export from alice to get consignment_key
      const exportResult = await httpReq(`${ALICE_URL}/api/v1/rgb/contracts/export`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    Buffer.from(JSON.stringify({ contract_id: contractId, format: 'zip' })),
      });
      if (exportResult.status !== 200) {
        jsonResp(res, 500, { error: 'export from alice failed', detail: JSON.parse(exportResult.body.toString()) });
        return;
      }
      const exportData       = JSON.parse(exportResult.body.toString());
      const consignmentKey   = exportData.consignment_key;
      console.log(`[export-to-bob] consignment_key=${consignmentKey}`);

      // 2. Download consignment binary from alice
      const dlResult = await httpReq(
        `${ALICE_URL}/api/v1/rgb/consignments/${consignmentKey}?format=zip`,
      );
      if (dlResult.status !== 200) {
        jsonResp(res, 500, { error: 'consignment download from alice failed' });
        return;
      }
      console.log(`[export-to-bob] downloaded ${dlResult.body.length} bytes`);

      // 3. Import consignment to bob
      const importResult = await httpReq(
        `${BOB_URL}/api/v1/rgb/contracts/import?contract_id=${encodeURIComponent(contractId)}&format=zip`,
        { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: dlResult.body },
      );
      const importData = JSON.parse(importResult.body.toString());
      console.log(`[export-to-bob] import status=${importResult.status}`);

      jsonResp(res, 200, {
        consignment_key:  consignmentKey,
        bytes_transferred: dlResult.body.length,
        import_result:    importData,
      });
      return;
    }

    // ── Poll Events Until Target Type ─────────────────────────────────────────

    if (p === '/wait-event' && req.method === 'POST') {
      const { node, eventType, maxPolls = 10 } = JSON.parse((await readBody(req)).toString());
      const nodeUrl = node === 'alice' ? ALICE_URL : BOB_URL;
      console.log(`[wait-event] node=${node} target=${eventType} maxPolls=${maxPolls}`);

      const events = [];
      let found    = null;

      for (let i = 0; i < maxPolls; i++) {
        // Long-poll for next event
        let evResult;
        try {
          evResult = await httpReq(`${nodeUrl}/api/v1/events/wait_next`, {
            method:    'POST',
            headers:   { 'Content-Type': 'application/json' },
            body:      Buffer.from('{}'),
            timeoutMs: 35000,
          });
        } catch (e) {
          console.log(`[wait-event] poll ${i + 1} timeout/error: ${e.message}`);
          break;
        }

        if (evResult.status !== 200) {
          console.log(`[wait-event] poll ${i + 1} non-200: ${evResult.status}`);
          break;
        }

        const ev = JSON.parse(evResult.body.toString());
        console.log(`[wait-event] poll ${i + 1} got: ${ev.type}`);
        events.push(ev);

        // ACK the event
        await httpReq(`${nodeUrl}/api/v1/events/handled`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    Buffer.from('{}'),
        });

        if (ev.type === eventType) {
          found = ev;
          break;
        }
      }

      jsonResp(res, 200, { found, events });
      return;
    }

    jsonResp(res, 404, { error: 'not found', path: p });
  } catch (err) {
    console.error(`[error] ${req.method} ${p}:`, err.message);
    jsonResp(res, 500, { error: err.message });
  }
});

// Bind to loopback only — prevents other machines on the same LAN from calling
// node APIs or Bitcoin RPC through this proxy without authentication.
server.listen(PORT, '127.0.0.1', () => {
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║      RGB-LDK Integration Demo Proxy Server           ║');
  console.log('║      Author: Stash Labs                              ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log(`\n  Demo URL : http://localhost:${PORT}`);
  console.log(`  Alice    : ${ALICE_URL}  (docker: ${ALICE_DOCKER_IP})`);
  console.log(`  Bob      : ${BOB_URL}   (docker: ${BOB_DOCKER_IP})`);
  console.log(`  Bitcoind : ${BTC_RPC_URL}`);
  console.log(`  Issuer   : ${ISSUER_FILE}\n`);
});
