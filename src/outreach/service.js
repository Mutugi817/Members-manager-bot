import { sleep, formatPhone } from '../core/utils.js';

export class OutreachService {
  constructor({ whatsapp, members, config, settings }) { this.whatsapp = whatsapp; this.members = members; this.config = config; this.settings = settings; }

  confirmationPayload(member) {
    const s = this.settings.peek();
    return { kind: 'interactive', text: `Greetings from ${s.churchName}.\n\nThis message confirms that your name is on our current member list.\n\nName: ${member.fullName}\nWhatsApp: ${formatPhone(member.phone)}\nReference: ${member.code}\n\nPlease keep your reference for future coordination.\n\n${s.transportNotice}`, footer: s.botFooter, buttons: [this.whatsapp.renderer.copyButton('Copy reference', `copy:${member.code}`, member.code)] };
  }

  invalidPayload(member) {
    const missing = !member.lastName ? 'Your second name is missing.' : 'Some of your membership details need attention.';
    return { kind: 'interactive', text: `Greetings from ${this.settings.peek().churchName}.\n\n${missing}\n\nPlease send ${this.settings.peek().keyword} in a private chat and choose Update details to complete your record.`, footer: this.settings.peek().botFooter, buttons: [this.whatsapp.renderer.quickReply('Open menu', `open:${this.settings.peek().keyword}`)] };
  }

  async notifyMembers(members) {
    const results = [];
    for (const member of members) {
      try {
        const jid = await this.whatsapp.resolveUserJid(member.phone);
        const sent = await this.whatsapp.sendToJid(jid, this.confirmationPayload(member));
        results.push({ memberId: member.id, code: member.code, ok: true, jid: sent?.key?.remoteJid || jid, messageId: sent?.messageId || sent?.key?.id || null });
      } catch (error) {
        results.push({ memberId: member.id, code: member.code, ok: false, error: error.message });
      }
      await sleep(this.config.outboundDelayMs);
    }
    return results;
  }

  async sendCampaign({ targetType, targetIds, payload }) {
    const targets = targetType === 'all_members' ? this.members.list({ status: 'active' }).filter(m => m.phone) : targetType === 'members' ? this.members.notificationTargets('selected', targetIds).filter(m => m.phone) : [];
    if (targetType === 'group' || targetType === 'groups' || targetType === 'all_groups') {
      const groups = await this.whatsapp.groups();
      const chosen = targetType === 'all_groups' ? groups : groups.filter(g => targetIds.includes(g.id));
      const results = [];
      for (const group of chosen) {
        try { const sent = await this.whatsapp.sendToJid(group.id, payload); results.push({ target: group.id, name: group.subject, ok: true, messageId: sent?.messageId || sent?.key?.id || null }); }
        catch (error) { results.push({ target: group.id, name: group.subject, ok: false, error: error.message }); }
        await sleep(this.config.outboundDelayMs);
      }
      return results;
    }
    const results = [];
    for (const member of targets) {
      try { const jid = await this.whatsapp.resolveUserJid(member.phone); const sent = await this.whatsapp.sendToJid(jid, payload); results.push({ target: jid, memberId: member.id, code: member.code, ok: true, messageId: sent?.messageId || sent?.key?.id || null }); }
      catch (error) { results.push({ target: member.phone, memberId: member.id, code: member.code, ok: false, error: error.message }); }
      await sleep(this.config.outboundDelayMs);
    }
    return results;
  }
}
