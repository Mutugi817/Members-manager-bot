import { sleep, formatPhone } from "../core/utils.js";

const MIN_OUTBOUND_INTERVAL_MS = 6000;
const BATCH_SIZE = 50;
const BATCH_DELAY_MS = 10 * 60 * 1000;
const MAX_CONSECUTIVE_FAILURES = 3;
const FAILURE_COOLDOWN_MS = 60000;

export class OutreachService {
  constructor({ whatsapp, members, config, settings }) {
    this.whatsapp = whatsapp;
    this.members = members;
    this.config = config;
    this.settings = settings;

    this.queueTail = Promise.resolve();
    this.lastSendStartedAt = 0;
    this.cooldownUntil = 0;
  }

  confirmationPayload(member) {
    const s = this.settings.peek();

    return {
      kind: "interactive",
      text:
        `Greetings from ${s.churchName}.\n\n` +
        `This message confirms that your name is on our current member list.\n\n` +
        `Name: ${member.fullName}\n` +
        `WhatsApp: ${formatPhone(member.phone)}\n` +
        `Reference: ${member.code}\n\n` +
        `Please keep your reference for future coordination.\n\n` +
        `${s.transportNotice}`,
      footer: s.botFooter,
      buttons: [
        this.whatsapp.renderer.copyButton(
          "Copy reference",
          `copy:${member.code}`,
          member.code,
        ),
      ],
    };
  }

  invalidPayload(member) {
    const settings = this.settings.peek();

    const missing = !member.lastName
      ? "Your second name is missing."
      : "Some of your membership details need attention.";

    return {
      kind: "interactive",
      text:
        `Greetings from ${settings.churchName}.\n\n` +
        `${missing}\n\n` +
        `Please send ${settings.keyword} in a private chat and choose Update details to complete your record.`,
      footer: settings.botFooter,
      buttons: [
        this.whatsapp.renderer.quickReply(
          "Open menu",
          `open:${settings.keyword}`,
        ),
      ],
    };
  }

  async notifyMembers(members) {
    const targets = Array.isArray(members)
      ? members.filter((member) => member?.phone)
      : [];

    return this.#enqueueBulk(
      targets,
      async (member) => {
        const jid = await this.whatsapp.resolveUserJid(member.phone);

        const sent = await this.whatsapp.sendToJid(
          jid,
          this.confirmationPayload(member),
        );

        return {
          memberId: member.id,
          code: member.code,
          ok: true,
          jid: sent?.key?.remoteJid || jid,
          messageId: sent?.messageId || sent?.key?.id || null,
        };
      },
      (member, error) => ({
        memberId: member.id,
        code: member.code,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }

  async sendCampaign({ targetType, targetIds, payload }) {
    if (
      targetType === "group" ||
      targetType === "groups" ||
      targetType === "all_groups"
    ) {
      const groups = await this.whatsapp.groups();

      const ids = Array.isArray(targetIds) ? targetIds : [];

      const chosen =
        targetType === "all_groups"
          ? groups
          : groups.filter((group) => ids.includes(group.id));

      return this.#enqueueBulk(
        chosen,
        async (group) => {
          const sent = await this.whatsapp.sendToJid(group.id, payload);

          return {
            target: group.id,
            name: group.subject,
            ok: true,
            messageId: sent?.messageId || sent?.key?.id || null,
          };
        },
        (group, error) => ({
          target: group.id,
          name: group.subject,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }

    let targets = [];

    if (targetType === "all_members") {
      targets = this.members
        .list({
          status: "active",
        })
        .filter((member) => member.phone);
    } else if (targetType === "members") {
      targets = this.members
        .notificationTargets(
          "selected",
          Array.isArray(targetIds) ? targetIds : [],
        )
        .filter((member) => member.phone);
    }

    return this.#enqueueBulk(
      targets,
      async (member) => {
        const jid = await this.whatsapp.resolveUserJid(member.phone);

        const sent = await this.whatsapp.sendToJid(jid, payload);

        return {
          target: jid,
          memberId: member.id,
          code: member.code,
          ok: true,
          messageId: sent?.messageId || sent?.key?.id || null,
        };
      },
      (member, error) => ({
        target: member.phone,
        memberId: member.id,
        code: member.code,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }

  async #enqueueBulk(targets, sender, failureResult) {
    const unique = this.#deduplicate(targets);

    if (!unique.length) {
      return [];
    }

    const job = this.queueTail
      .catch(() => {})
      .then(() => this.#runBulk(unique, sender, failureResult));

    this.queueTail = job.catch(() => {});

    return job;
  }

  #deduplicate(targets) {
    const seen = new Set();
    const result = [];

    for (const target of targets) {
      const key = this.#targetKey(target);

      if (!key || seen.has(key)) {
        continue;
      }

      seen.add(key);
      result.push(target);
    }

    return result;
  }

  #targetKey(target) {
    if (target && typeof target === "object") {
      return String(
        target.jid || target.whatsappJid || target.id || target.phone || "",
      ).trim();
    }

    return String(target || "").trim();
  }

  async #runBulk(targets, sender, failureResult) {
    const results = [];

    const batches = [];

    for (let index = 0; index < targets.length; index += BATCH_SIZE) {
      batches.push(targets.slice(index, index + BATCH_SIZE));
    }

    const initialCooldown = this.cooldownUntil - Date.now();

    if (initialCooldown > 0) {
      await sleep(initialCooldown);
    }

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
      const batch = batches[batchIndex];

      let consecutiveFailures = 0;

      for (let index = 0; index < batch.length; index += 1) {
        const target = batch[index];

        if (this.lastSendStartedAt > 0) {
          const elapsed = Date.now() - this.lastSendStartedAt;

          const remaining = MIN_OUTBOUND_INTERVAL_MS - elapsed;

          if (remaining > 0) {
            await sleep(remaining);
          }
        }

        if (this.cooldownUntil > Date.now()) {
          await sleep(this.cooldownUntil - Date.now());
        }

        this.lastSendStartedAt = Date.now();

        try {
          const result = await sender(target, index);

          results.push(result);

          consecutiveFailures = 0;
        } catch (error) {
          consecutiveFailures += 1;

          results.push(failureResult(target, error));

          if (
            this.#isCriticalError(error) ||
            consecutiveFailures >= MAX_CONSECUTIVE_FAILURES
          ) {
            this.cooldownUntil = Date.now() + FAILURE_COOLDOWN_MS;

            return results;
          }
        }
      }

      const hasAnotherBatch = batchIndex < batches.length - 1;

      if (hasAnotherBatch) {
        await sleep(BATCH_DELAY_MS);
      }
    }

    return results;
  }

  #isCriticalError(error) {
    const status = Number(
      error?.statusCode ?? error?.status ?? error?.output?.statusCode ?? 0,
    );

    if (status === 401 || status === 403 || status === 429) {
      return true;
    }

    const message = String(error?.message || error || "").toLowerCase();

    return [
      "rate limit",
      "too many requests",
      "logged out",
      "unauthorized",
      "forbidden",
      "not-authorized",
      "connection closed",
      "connection was closed",
      "baileys socket",
      "session",
    ].some((pattern) => message.includes(pattern));
  }
}
