import dgram from 'node:dgram';
import os from 'node:os';
import { ANDROID_CLIENT, IOS_CLIENT, REQUEST_URL, UDP_PORT } from './settings';

export interface RemoteKey {
  name: string;
  value: number;
}

export interface Remote {
  name: string;
  ip: string;
  mac: string;
  type: number;
  project: number;
  id: number;
  frequency: number;
  keys: RemoteKey[];
}

interface CloudDevice {
  mac: string;
  ip: string;
  type: number | string;
  project: number | string;
}

interface CloudKey {
  k_name: string;
  value: number | string;
}

interface CloudRemote {
  r_name: string;
  id: number | string;
  frequency: number | string;
  key: CloudKey[];
}

interface CloudResponse<T> {
  result: number;
  message: T[];
}

function crc8(buf: Buffer, length: number): number {
  let crc = 0;
  for (let i = 0; i < length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc & 1) ? ((crc >>> 1) ^ 0x8c) : (crc >>> 1);
    }
  }
  return crc & 0xff;
}

function hexMacToBytes(mac: string): Buffer {
  const cleaned = mac.replace(/[:\-\s]/g, '').toLowerCase();
  if (cleaned.length !== 12 || !/^[0-9a-f]{12}$/.test(cleaned)) {
    throw new Error(`Invalid MAC: ${mac}`);
  }
  return Buffer.from(cleaned, 'hex');
}

function localMac(): string {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const i of ifaces[name] ?? []) {
      if (!i.internal && i.mac && i.mac !== '00:00:00:00:00:00') {
        return i.mac.replace(/:/g, '');
      }
    }
  }
  // Fallback: random 48-bit
  const buf = Buffer.alloc(6);
  for (let i = 0; i < 6; i++) buf[i] = Math.floor(Math.random() * 256);
  return buf.toString('hex');
}

export function buildPacket(
  remote: Remote,
  keyValue: number | null,
  senderMac: string,
  sequence: number,
): Buffer {
  const hasKey = keyValue !== null;
  const bodyLen = hasKey ? 41 : 29;
  const parts: number[] = [];

  parts.push(0xfe);
  parts.push(hasKey ? 1 : 2);
  parts.push(remote.type & 0xff);
  parts.push(remote.project & 0xff);

  const sender = hexMacToBytes(senderMac);
  const receiver = hexMacToBytes(remote.mac);
  const head = Buffer.from(parts);
  const zeros8 = Buffer.alloc(8, 0);

  let body: Buffer;
  if (hasKey) {
    const payload = Buffer.alloc(12);
    payload.writeUInt32BE(remote.id >>> 0, 0);
    // bytes 4-7: zeros
    payload.writeUInt16BE(remote.frequency & 0xffff, 8);
    payload.writeUInt8(keyValue! & 0xff, 10);
    payload.writeUInt8(0, 11);
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

  // Append sequence
  const seq = Buffer.from([sequence & 0xff]);
  const withSeq = Buffer.concat([body, seq]);

  if (withSeq.length !== bodyLen) {
    throw new Error(`Packet length mismatch: ${withSeq.length} vs ${bodyLen}`);
  }

  const crc = crc8(withSeq, bodyLen);
  return Buffer.concat([withSeq, Buffer.from([crc, 0xef])]);
}

let _seq = 0;
function nextSequence(): number {
  _seq = (_seq + 1) & 0xff;
  return _seq;
}

const _senderMac = localMac();

export async function sendCommand(remote: Remote, keyName: string | ''): Promise<void> {
  let keyValue: number | null = null;
  if (keyName !== '') {
    const found = remote.keys.find(k => k.name === keyName);
    if (!found) throw new Error(`Key "${keyName}" not found on remote "${remote.name}"`);
    keyValue = found.value;
  }

  const packet = buildPacket(remote, keyValue, _senderMac, nextSequence());
  await new Promise<void>((resolve, reject) => {
    const sock = dgram.createSocket('udp4');
    sock.send(packet, UDP_PORT, remote.ip, (err) => {
      sock.close();
      if (err) reject(err);
      else resolve();
    });
  });
}

function toForm(data: Record<string, string>): string {
  return Object.entries(data)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

async function cloudPost<T>(path: string, body: Record<string, string>, useAndroid: boolean): Promise<CloudResponse<T>> {
  const client = useAndroid ? ANDROID_CLIENT : IOS_CLIENT;
  const res = await fetch(REQUEST_URL + path, {
    method: 'POST',
    headers: client.headers,
    body: toForm(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${path}`);
  return (await res.json()) as CloudResponse<T>;
}

export async function fetchRemotesFromCloud(account: string, useAndroid = true): Promise<Remote[]> {
  const client = useAndroid ? ANDROID_CLIENT : IOS_CLIENT;
  const deviceRes = await cloudPost<CloudDevice>('get_all_device_data.php',
    { account, security_code: client.security_code }, useAndroid);
  if (deviceRes.result !== 0) {
    throw new Error(`Safemate returned result=${deviceRes.result} when fetching devices`);
  }

  const out: Remote[] = [];
  for (const device of deviceRes.message ?? []) {
    const remoteRes = await cloudPost<CloudRemote>('get_remote_controller.php',
      { mac: device.mac, security_code: client.security_code }, useAndroid);
    if (remoteRes.result !== 0) continue;
    for (const r of remoteRes.message ?? []) {
      out.push({
        name: r.r_name,
        ip: device.ip,
        mac: device.mac,
        type: Number(device.type),
        project: Number(device.project),
        id: Number(r.id),
        frequency: Number(r.frequency),
        keys: (r.key ?? []).map(k => ({ name: k.k_name, value: Number(k.value) })),
      });
    }
  }
  return out;
}
