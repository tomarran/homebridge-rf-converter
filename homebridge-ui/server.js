'use strict';

const { HomebridgePluginUiServer, RequestError } = require('@homebridge/plugin-ui-utils');
const dgram = require('node:dgram');
const os = require('node:os');

const REQUEST_URL = 'http://47.254.152.213/yetcloud_release/';
const UDP_PORT = 26258;

const ANDROID = {
  security_code: 'SDLKELS384DJ29Z49021DX30D92KS58S',
  headers: {
    'Cache-Control': 'no-cache',
    'Content-Type': 'application/x-www-form-urlencoded',
    'Connection': 'keep-alive',
    'Accept-Encoding': 'gzip',
    'User-Agent': 'okhttp/3.12.0',
  },
};
const IOS = {
  security_code: 'DSKWIJAKZXLQPSZMANXVTBFGYHPNVCRE',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Connection': 'keep-alive',
    'Accept': '*/*',
    'User-Agent': 'Safemate/2.2.1 (iPhone; iOS 17.1.2; Scale/3.00)',
    'Accept-Language': 'ko-KR;q=1, en-KR;q=0.9, ja-KR;q=0.8',
  },
};

function toForm(data) {
  return Object.entries(data)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
}

async function cloudPost(path, body, useAndroid) {
  const client = useAndroid ? ANDROID : IOS;
  const res = await fetch(REQUEST_URL + path, {
    method: 'POST',
    headers: client.headers,
    body: toForm(body),
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} on ${path} — body: ${text.slice(0, 300)}`);
    err.raw = text;
    throw err;
  }
  try {
    const json = JSON.parse(text);
    json._raw = text;
    return json;
  } catch (_) {
    const err = new Error(`Non-JSON response on ${path}: ${text.slice(0, 300)}`);
    err.raw = text;
    throw err;
  }
}

function crc8(buf, length) {
  let crc = 0;
  for (let i = 0; i < length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc & 1) ? ((crc >>> 1) ^ 0x8c) : (crc >>> 1);
    }
  }
  return crc & 0xff;
}

function hexMacToBytes(mac) {
  const cleaned = String(mac).replace(/[:\-\s]/g, '').toLowerCase();
  if (cleaned.length !== 12 || !/^[0-9a-f]{12}$/.test(cleaned)) {
    throw new Error(`Invalid MAC: ${mac}`);
  }
  return Buffer.from(cleaned, 'hex');
}

function localMac() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const i of ifaces[name] || []) {
      if (!i.internal && i.mac && i.mac !== '00:00:00:00:00:00') {
        return i.mac.replace(/:/g, '');
      }
    }
  }
  const buf = Buffer.alloc(6);
  for (let i = 0; i < 6; i++) buf[i] = Math.floor(Math.random() * 256);
  return buf.toString('hex');
}

let _seq = 0;
function buildPacket(remote, keyValue, senderMac) {
  const hasKey = keyValue !== null && keyValue !== undefined;
  const bodyLen = hasKey ? 41 : 29;
  const head = Buffer.from([
    0xfe,
    hasKey ? 1 : 2,
    remote.type & 0xff,
    remote.project & 0xff,
  ]);
  const sender = hexMacToBytes(senderMac);
  const receiver = hexMacToBytes(remote.mac);
  const zeros8 = Buffer.alloc(8, 0);

  let body;
  if (hasKey) {
    const payload = Buffer.alloc(12);
    payload.writeUInt32BE((remote.id >>> 0), 0);
    payload.writeUInt16BE(remote.frequency & 0xffff, 8);
    payload.writeUInt8(keyValue & 0xff, 10);
    body = Buffer.concat([
      head, sender, receiver, zeros8,
      Buffer.from([0x02, 0x01, 0x00, 0x0c]),
      payload,
    ]);
  } else {
    body = Buffer.concat([
      head, sender, receiver, zeros8,
      Buffer.from([0x21, 0x01, 0x00, 0x00]),
    ]);
  }

  _seq = (_seq + 1) & 0xff;
  const withSeq = Buffer.concat([body, Buffer.from([_seq])]);
  if (withSeq.length !== bodyLen) {
    throw new Error(`Packet length mismatch: ${withSeq.length} vs ${bodyLen}`);
  }
  const crc = crc8(withSeq, bodyLen);
  return Buffer.concat([withSeq, Buffer.from([crc, 0xef])]);
}

function sendUDP(remote, keyValue) {
  return new Promise((resolve, reject) => {
    const packet = buildPacket(remote, keyValue, localMac());
    const sock = dgram.createSocket('udp4');
    sock.send(packet, UDP_PORT, remote.ip, (err) => {
      sock.close();
      if (err) reject(err);
      else resolve();
    });
  });
}

class UiServer extends HomebridgePluginUiServer {
  constructor() {
    super();

    this.onRequest('/fetch-remotes', this.fetchRemotes.bind(this));
    this.onRequest('/test-key', this.testKey.bind(this));

    this.ready();
  }

  async fetchRemotes({ account, useAndroid, password }) {
    if (!account || typeof account !== 'string') {
      throw new RequestError('Account is required.', { status: 400 });
    }
    const trimmed = account.trim();
    try {
      const useAnd = useAndroid === true; // default = iOS now
      const client = useAnd ? ANDROID : IOS;

      // Optional: log in first to establish a server-side session
      if (password) {
        const login = await cloudPost('user_login.php', {
          account: trimmed,
          password,
          security_code: client.security_code,
          app_type: '1',
          app_version: '2.2.11',
          current_date: new Date().toISOString().slice(0, 19).replace('T', ' '),
          devicetoken: '',
        }, useAnd);
        if (login.result !== 0) {
          const msg = typeof login.message === 'string' ? ` ("${login.message}")` : '';
          throw new RequestError(
            `Login failed: result=${login.result}, errno=${login.errno ?? '?'}${msg}.\nRaw: ${String(login._raw || '').slice(0, 400)}`,
            { status: 400 },
          );
        }
      }

      const devices = await cloudPost('get_all_device_data.php',
        { account: trimmed, security_code: client.security_code }, useAnd);
      if (devices.result !== 0) {
        const msg = typeof devices.message === 'string' ? devices.message : null;
        const hint = devices.result === 1
          ? ` This usually means the account string doesn't match what's in the Safemate app — try the iOS client toggle, check for typos / whitespace, or confirm the account has at least one device paired in the app.`
          : '';
        throw new RequestError(
          `Safemate returned result=${devices.result}${msg ? ` ("${msg}")` : ''}.${hint}\nRaw: ${String(devices._raw || '').slice(0, 400)}`,
          { status: 400 },
        );
      }
      const remotes = [];
      let totalRemotesFromCloud = 0;
      for (const device of devices.message || []) {
        const rs = await cloudPost('get_remote_controller.php',
          { mac: device.mac, security_code: client.security_code }, useAnd);
        if (rs.result !== 0) continue;
        totalRemotesFromCloud += (rs.message || []).length;
        for (const r of rs.message || []) {
          remotes.push({
            name: r.r_name,
            ip: device.ip,
            mac: device.mac,
            type: Number(device.type),
            project: Number(device.project),
            id: Number(r.id),
            frequency: Number(r.frequency),
            keys: (r.key || []).map(k => ({ name: k.k_name, value: Number(k.value) })),
          });
        }
      }
      return { remotes, deviceCount: (devices.message || []).length, totalRemotesFromCloud };
    } catch (err) {
      if (err instanceof RequestError) throw err;
      throw new RequestError(`Failed to fetch from Safemate: ${err.message}`, { status: 500 });
    }
  }

  async testKey({ remote, keyName }) {
    if (!remote || !remote.ip || !remote.mac) {
      throw new RequestError('Remote is missing required fields.', { status: 400 });
    }
    try {
      let keyValue = null;
      if (keyName) {
        const k = (remote.keys || []).find(x => x.name === keyName);
        if (!k) throw new RequestError(`Key "${keyName}" not found.`, { status: 400 });
        keyValue = k.value;
      }
      await sendUDP(remote, keyValue);
      return { ok: true };
    } catch (err) {
      if (err instanceof RequestError) throw err;
      throw new RequestError(`UDP send failed: ${err.message}`, { status: 500 });
    }
  }
}

(() => new UiServer())();
