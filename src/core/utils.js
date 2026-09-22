import crypto from 'node:crypto';
import { jidDecode } from '@whiskeysockets/baileys';

export function bool(value, fallback = false) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return fallback;
  }

  return [
    '1',
    'true',
    'yes',
    'on'
  ].includes(
    String(value)
      .trim()
      .toLowerCase()
  );
}

export function number(value, fallback) {
  const parsed = Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : fallback;
}

export function required(name, min) {
  const value =
    process.env[name] || '';

  if (value.length < min) {
    throw new Error(
      `${name} must be at least ${min} characters.`
    );
  }

  return value;
}

export function nowIso() {
  return new Date().toISOString();
}

export function cleanText(value) {
  return String(value || '')
    .replace(
      /[\u0000-\u001F\u007F]/g,
      ''
    )
    .trim();
}

export function normalizePhone(value) {
  const raw =
    String(value ?? '')
      .replace(/\D/g, '');

  if (!raw) {
    return null;
  }

  if (
    raw.startsWith('254') &&
    raw.length === 12
  ) {
    return raw;
  }

  if (
    raw.startsWith('0') &&
    raw.length === 10
  ) {
    return `254${raw.slice(1)}`;
  }

  if (
    raw.length === 9 &&
    raw.startsWith('7')
  ) {
    return `254${raw}`;
  }

  return null;
}

export function phoneFromJid(jid) {
  const value =
    String(jid || '')
      .trim();

  if (!value) {
    return null;
  }

  const decoded =
    jidDecode(value);

  if (!decoded) {
    return null;
  }

  /*
   * Only a PN JID can be converted to a phone number.
   *
   * Example:
   *
   * 254787720812@s.whatsapp.net
   *       -> 254787720812
   *
   * 224305354940523@lid
   *       -> null
   *
   * An LID is not a phone number.
   */
  if (
    decoded.server !==
      's.whatsapp.net' &&
    decoded.server !==
      'c.us'
  ) {
    return null;
  }

  const digits =
    String(decoded.user || '')
      .replace(/\D/g, '');

  return normalizePhone(
    digits
  );
}

export function jidForPhone(phone) {
  const normalized =
    normalizePhone(phone);

  if (!normalized) {
    return null;
  }

  /*
   * Do not use a LID here.
   *
   * A member's durable database identity is the
   * canonical phone-number JID.
   */
  return `${normalized}@s.whatsapp.net`;
}

export function isGroupJid(jid) {
  return String(jid || '')
    .endsWith('@g.us');
}

export function uuid() {
  return crypto.randomUUID();
}

export function timingSafeEqualText(a, b) {
  const left =
    Buffer.from(
      String(a)
    );

  const right =
    Buffer.from(
      String(b)
    );

  if (
    left.length !==
    right.length
  ) {
    return false;
  }

  return crypto.timingSafeEqual(
    left,
    right
  );
}

export function formatPhone(phone) {
  const p =
    normalizePhone(phone);

  return p
    ? `+${p}`
    : 'Not provided';
}

export function nextReferenceCode(
  prefix,
  startNumber,
  pad,
  existingCodes = []
) {
  const escaped =
    prefix.replace(
      /[.*+?^${}()|[\]\\]/g,
      '\\$&'
    );

  const pattern =
    new RegExp(
      `^${escaped}(\\d+)$`,
      'i'
    );

  let max =
    startNumber - 1;

  for (
    const code of existingCodes
  ) {
    const match =
      pattern.exec(
        String(code || '')
      );

    if (match) {
      max = Math.max(
        max,
        Number(match[1])
      );
    }
  }

  return (
    `${prefix}` +
    `${String(
      max + 1
    ).padStart(
      pad,
      '0'
    )}`
  );
}

export function sleep(ms) {
  return new Promise(
    (resolve) =>
      setTimeout(
        resolve,
        ms
      )
  );
}