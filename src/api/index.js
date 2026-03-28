export async function api(node, path, method = 'GET', body = null) {
  const url = `/${node}${path}`;
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== null) opts.body = JSON.stringify(body);
  const r = await fetch(url, opts);
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

export async function bitcoin(method, params = []) {
  const r = await fetch('/bitcoin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '1.0', method, params, id: '1' }),
  });
  const d = await r.json();
  if (d.error) throw new Error(d.error.message);
  return d.result;
}

export async function bitcoinAdmin(method, params = []) {
  const r = await fetch('/bitcoin?wallet=', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '1.0', method, params, id: '1' }),
  });
  const d = await r.json();
  if (d.error && d.error.code !== -4 && d.error.code !== -35) throw new Error(d.error.message);
  return d.result;
}

export async function serverAction(endpoint, body = {}) {
  const r = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

export async function sha256hex(hexStr) {
  const buf = hexToBytes(hexStr);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export function hexToBytes(hex) {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < arr.length; i++) arr[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return arr;
}

export function randHex(len) {
  return Array.from(crypto.getRandomValues(new Uint8Array(len)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
