import { sleep, formatPhone } from "../core/utils.js";

const MIN_BULK_MESSAGE_DELAY_MS = 6000;
const BULK_JOB_COOLDOWN_MS = 30000;
const MAX_BULK_RECIPIENTS = 40;
const MAX_CONSECUTIVE_FAILURES = 3;
const CRITICAL_FAILURE_COOLDOWN_MS = 60000;

export class OutreachService {
  constructor({ whatsapp, members, config, settings }) {
    this.whatsapp = whatsapp;
    this.members = members;
    this.config = config;
    this.settings = settings;

    this.queueTail = Promise.resolve();
    this.lastSendAt = 0;
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

    return this.#queueBulk(
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
      {
        buildFailureResult: (member, error) => ({
          memberId: member.id,

          code: member.code,

          ok: false,

          error: error instanceof Error ? error.message : String(error),
        }),
      },
    );
  }

  async sendCampaign({ targetType, targetIds, payload }) {
    if (
      targetType === "group" ||
      targetType === "groups" ||
      targetType === "all_groups"
    ) {
      const groups = await this.whatsapp.groups();

      const chosen =
        targetType === "all_groups"
          ? groups
          : groups.filter(
              (group) =>
                Array.isArray(targetIds) && targetIds.includes(group.id),
            );

      return this.#queueBulk(
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
        {
          buildFailureResult: (group, error) => ({
            target: group.id,

            name: group.subject,

            ok: false,

            error: error instanceof Error ? error.message : String(error),
          }),
        },
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

    return this.#queueBulk(
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
      {
        buildFailureResult: (member, error) => ({
          target: member.phone,

          memberId: member.id,

          code: member.code,

          ok: false,

          error: error instanceof Error ? error.message : String(error),
        }),
      },
    );
  }

  #minimumInterval() {
    const configured = Number(this.config?.outboundDelayMs);

    if (
      Number.isFinite(configured) &&
      configured >= MIN_BULK_MESSAGE_DELAY_MS
    ) {
      return configured;
    }

    return MIN_BULK_MESSAGE_DELAY_MS;
  }

  async #queueBulk(targets, sender, { buildFailureResult }) {
    if (!Array.isArray(targets) || targets.length === 0) {
      return [];
    }

    if (MAX_BULK_RECIPIENTS > 0 && targets.length > MAX_BULK_RECIPIENTS) {
      throw new Error(
        `Bulk recipient count ${targets.length} exceeds the configured maximum of ${MAX_BULK_RECIPIENTS}.`,
      );
    }

    const uniqueTargets = this.#deduplicateTargets(targets);

    if (uniqueTargets.length === 0) {
      return [];
    }

    const job = this.queueTail
      .catch(() => {})
      .then(() =>
        this.#runBulk(uniqueTargets, sender, {
          buildFailureResult,
        }),
      );

    this.queueTail = job.catch(() => {});

    return job;
  }

  #deduplicateTargets(targets) {
    const seen = new Set();

    const unique = [];

    for (const target of targets) {
      const key = this.#targetKey(target);

      if (!key) {
        continue;
      }

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);

      unique.push(target);
    }

    return unique;
  }

  #targetKey(target) {
    if (target && typeof target === "object") {
      return String(
        target.jid || target.id || target.whatsappJid || target.phone || "",
      ).trim();
    }

    return String(target || "").trim();
  }

  async #runBulk(targets, sender, { buildFailureResult }) {
    const minimumInterval = this.#minimumInterval();

    const cooldownRemaining = this.cooldownUntil - Date.now();

    if (cooldownRemaining > 0) {
      await sleep(cooldownRemaining);
    }

    const results = [];

    let consecutiveFailures = 0;

    for (let index = 0; index < targets.length; index += 1) {
      const target = targets[index];

      const elapsed = Date.now() - this.lastSendAt;

      const remaining = minimumInterval - elapsed;

      if (this.lastSendAt > 0 && remaining > 0) {
        await sleep(remaining);
      }

      const currentCooldown = this.cooldownUntil - Date.now();

      if (currentCooldown > 0) {
        await sleep(currentCooldown);
      }

      this.lastSendAt = Date.now();

      try {
        const result = await sender(target, index);

        results.push(result);

        consecutiveFailures = 0;
      } catch (error) {
        consecutiveFailures += 1;

        const result =
          typeof buildFailureResult === "function"
            ? buildFailureResult(target, error)
            : {
                ok: false,

                error: error instanceof Error ? error.message : String(error),
              };

        results.push(result);

        if (this.#isCriticalError(error)) {
          this.cooldownUntil = Math.max(
            this.cooldownUntil,
            Date.now() + CRITICAL_FAILURE_COOLDOWN_MS,
          );

          break;
        }

        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          this.cooldownUntil = Math.max(
            this.cooldownUntil,
            Date.now() + CRITICAL_FAILURE_COOLDOWN_MS,
          );

          break;
        }
      }
    }

    if (this.lastSendAt > 0) {
      this.cooldownUntil = Math.max(
        this.cooldownUntil,
        this.lastSendAt + BULK_JOB_COOLDOWN_MS,
      );
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

    const criticalPatterns = [
      "rate limit",
      "too many requests",
      "logged out",
      "unauthorized",
      "forbidden",
      "not-authorized",
      "session",
      "connection closed",
      "connection was closed",
      "baileys socket",
    ];

    return criticalPatterns.some((pattern) => message.includes(pattern));
  }
}
