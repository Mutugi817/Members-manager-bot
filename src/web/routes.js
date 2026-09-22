import fs from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '../core/errors.js';
import { formatPhone } from '../core/utils.js';

export function registerRoutes({ app, config, requireAdmin, members, whatsapp, outreach, scheduler, settings }) {
  app.get('/api/dashboard', { preHandler: requireAdmin }, async () => ({ stats: members.stats(), whatsapp: whatsapp.status(), reminders: scheduler.list().length, schedulerEnabled: config.enableScheduledMessages, settings: settings.peek() }));

  app.get('/api/members', { preHandler: requireAdmin }, async request => ({ members: members.list({ status: request.query?.status || 'active', q: request.query?.q || '' }) }));

  app.get('/api/settings', { preHandler: requireAdmin }, async () => ({ settings: settings.peek() }));
  app.patch('/api/settings', { preHandler: requireAdmin }, async request => ({ settings: await settings.update(request.body || {}) }));

  app.get('/api/whatsapp/status', { preHandler: requireAdmin }, async () => whatsapp.status());
  app.get('/api/whatsapp/qr', { preHandler: requireAdmin }, async () => ({ dataUrl: await whatsapp.qrDataUrl() }));
  app.post('/api/whatsapp/pairing-code', { preHandler: requireAdmin }, async request => ({ code: await whatsapp.requestPairingCode(request.body?.phone) }));
  app.get('/api/whatsapp/groups', { preHandler: requireAdmin }, async () => ({ groups: await whatsapp.groups() }));

  app.post('/api/outreach/confirm-members', { preHandler: requireAdmin, config: { rateLimit: { max: 3, timeWindow: '1 minute' } } }, async request => {
    if (!whatsapp.isConnected()) throw new AppError('Connect WhatsApp before sending member confirmations.', 503, 'WHATSAPP_OFFLINE');
    const mode = request.body?.mode === 'selected' ? 'selected' : 'all';
    const memberIds = Array.isArray(request.body?.memberIds) ? request.body.memberIds : [];
    const selected = members.notificationTargets(mode, memberIds).filter(m => m.phone);
    const results = await outreach.notifyMembers(selected);
    return { ok: true, requested: selected.length, sent: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length, results };
  });

  app.post('/api/messages/send', { preHandler: requireAdmin, config: { rateLimit: { max: 8, timeWindow: '1 minute' } } }, async request => {
    const body = request.body || {};
    if (!whatsapp.isConnected()) throw new AppError('Connect WhatsApp before sending messages.', 503, 'WHATSAPP_OFFLINE');
    return { ok: true, results: await outreach.sendCampaign({ targetType: body.targetType, targetIds: Array.isArray(body.targetIds) ? body.targetIds : [], payload: sanitizePayload(body.payload) }) };
  });

  app.get('/api/reminders', { preHandler: requireAdmin }, async () => ({ reminders: scheduler.list(), enabled: config.enableScheduledMessages }));
  app.post('/api/reminders', { preHandler: requireAdmin }, async request => ({ reminder: await scheduler.create(request.body || {}), enabled: config.enableScheduledMessages }));
  app.delete('/api/reminders/:id', { preHandler: requireAdmin }, async request => ({ reminder: await scheduler.stop(request.params.id) }));

  app.post('/api/uploads/image', { preHandler: requireAdmin }, async request => {
    const part = await request.file();
    if (!part) throw new AppError('Choose an image first.', 400, 'IMAGE_REQUIRED');
    const allowed = new Map([['image/jpeg','.jpg'],['image/png','.png'],['image/webp','.webp']]);
    if (!allowed.has(part.mimetype)) throw new AppError('Use JPEG, PNG or WebP.', 400, 'INVALID_IMAGE');
    const file = `image_${Date.now()}_${Math.random().toString(16).slice(2)}${allowed.get(part.mimetype)}`;
    const destination = path.join(config.uploadDir, file);
    await fs.writeFile(destination, await part.toBuffer());
    return { path: destination, filename: file, mimetype: part.mimetype };
  });

  function sanitizePayload(payload = {}) {
    const kind = payload.kind || 'text';
    if (kind === 'text') return { kind, text: String(payload.text || '').trim() };
    if (kind === 'post') return { kind: 'image', image: payload.image, caption: String(payload.caption || '').trim() };
    if (kind === 'event') {
      const startDate = new Date(payload.startDate); const endDate = new Date(payload.endDate || payload.startDate);
      if (!Number.isFinite(startDate.getTime())) throw new AppError('Enter a valid event start time.', 400, 'INVALID_EVENT_TIME');
      if (!Number.isFinite(endDate.getTime())) throw new AppError('Enter a valid event end time.', 400, 'INVALID_EVENT_TIME');
      return { kind, event: { name: String(payload.name || '').trim(), description: String(payload.description || '').trim(), startDate, endDate, extraGuestsAllowed: Boolean(payload.extraGuestsAllowed), ...(payload.location?.name ? { location: { name: String(payload.location.name), degreesLatitude: Number(payload.location.lat || 0), degreesLongitude: Number(payload.location.lng || 0) } } : {}) } };
    }
    if (kind === 'menu') return { kind: 'interactive', text: String(payload.text || ''), footer: String(payload.footer || ''), buttons: Array.isArray(payload.buttons) ? payload.buttons : [] };
    if (kind === 'carousel') return { kind, text: String(payload.text || ''), footer: String(payload.footer || ''), cards: Array.isArray(payload.cards) ? payload.cards.slice(0, 10).map(card => ({ id: String(card.id || ''), title: String(card.title || ''), body: String(card.body || ''), footer: String(card.footer || ''), image: card.image ? String(card.image) : null, buttons: Array.isArray(card.buttons) ? card.buttons.slice(0, 4) : [] })) : [] };
    throw new AppError('Unsupported message type.', 400, 'INVALID_MESSAGE_TYPE');
  }
}
