import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;
const VERSION = 1;

interface Envelope {
  v: number;
  iv: string;
  tag: string;
  ct: string;
}

function loadMasterKey(): Buffer {
  const raw = process.env.OPTUMUS_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'OPTUMUS_ENCRYPTION_KEY is not set. Generate one with `openssl rand -base64 32` and add it to web/.env.',
    );
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `OPTUMUS_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes (got ${key.length}). Use \`openssl rand -base64 32\`.`,
    );
  }
  return key;
}

export function encryptApiKey(plaintext: string): string {
  const key = loadMasterKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const envelope: Envelope = {
    v: VERSION,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ct: ct.toString('base64'),
  };
  return JSON.stringify(envelope);
}

export function decryptApiKey(envelopeJson: string | null | undefined): string | null {
  if (!envelopeJson) return null;
  let envelope: Envelope;
  try {
    envelope = JSON.parse(envelopeJson) as Envelope;
  } catch {
    return null;
  }
  if (envelope.v !== VERSION) return null;
  if (!envelope.iv || !envelope.tag || !envelope.ct) return null;
  try {
    const key = loadMasterKey();
    const iv = Buffer.from(envelope.iv, 'base64');
    const tag = Buffer.from(envelope.tag, 'base64');
    const ct = Buffer.from(envelope.ct, 'base64');
    const decipher = createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return pt.toString('utf8');
  } catch {
    return null;
  }
}

export function last4(plaintext: string): string {
  return plaintext.slice(-4);
}
