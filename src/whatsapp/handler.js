import { isPnUser, jidNormalizedUser } from "@whiskeysockets/baileys";

import { cleanText, isGroupJid } from "../core/utils.js";

const BULK_MESSAGE_DELAY_MS = 6000;

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export class MessageHandler {
  constructor({ config, members, flow, menu, whatsapp, settings }) {
    this.config = config;
    this.members = members;
    this.flow = flow;
    this.menu = menu;
    this.whatsapp = whatsapp;
    this.settings = settings;

    /*
     * Only one bulk broadcast may run at a time.
     *
     * This prevents two separate broadcast jobs from doing:
     *
     * Job A -> recipient 1
     * Job B -> recipient 1
     * Job A -> recipient 2
     * Job B -> recipient 2
     *
     * which would defeat the intended delay.
     */
    this.bulkSending = false;
  }

  async handle(message) {
    if (!message?.message || message?.key?.fromMe) {
      return;
    }

    const rawRemoteJid = message.key?.remoteJid;

    if (!rawRemoteJid) {
      return;
    }

    const remoteJid = jidNormalizedUser(rawRemoteJid) || rawRemoteJid;

    /*
     * IMPORTANT:
     *
     * This MUST be awaited.
     */
    const actorJid = await this.#resolveActorJid(message, remoteJid);

    if (!actorJid) {
      return;
    }

    const interaction = this.#interaction(message);

    if (interaction?.id) {
      const flowResult = await this.flow.action(actorJid, interaction.id);

      if (flowResult) {
        const destination = this.#replyDestination(
          remoteJid,
          actorJid,
          interaction.id,
        );

        return this.#sendResult(
          destination,
          actorJid,
          flowResult,
          destination === remoteJid ? message : undefined,
        );
      }

      return this.#menuAction(interaction.id, remoteJid, actorJid, message);
    }

    const text = cleanText(this.#text(message));

    if (!text) {
      return;
    }

    const flowResult = await this.flow.text(actorJid, text);

    if (flowResult) {
      return this.#sendResult(remoteJid, actorJid, flowResult, message);
    }

    const keyword = String(this.settings().keyword || this.config.botKeyword)
      .trim()
      .toLowerCase();

    if (text.toLowerCase() !== keyword) {
      return;
    }

    if (isGroupJid(remoteJid) && !this.config.allowGroupMenu) {
      return;
    }

    const member = await this.#memberForMessage(message, actorJid);

    return this.whatsapp.sendMenu(remoteJid, this.menu.main(member), message);
  }

  /*
   * --------------------------------------------------------------------------
   * BULK MESSAGE SENDING
   * --------------------------------------------------------------------------
   *
   * Sends messages strictly one recipient at a time.
   *
   * Recipient 1
   *      ↓
   * wait 6 seconds
   *      ↓
   * Recipient 2
   *      ↓
   * wait 6 seconds
   *      ↓
   * Recipient 3
   *
   * IMPORTANT:
   *
   * Promise.all() is deliberately NOT used.
   *
   * The delay can be configured to something longer than 6 seconds,
   * but never shorter than 6 seconds.
   *
   * This method also prevents a second bulk operation from running
   * concurrently with an existing one.
   *
   * `payloadFactory` may either be:
   *
   *   1. A single payload object shared by everyone.
   *
   *   2. A function:
   *
   *      async (jid, index) => payload
   *
   * This allows personalized bulk messages.
   */
  async sendBulkMessages(
    recipients,
    payloadFactory,
    { delayMs = BULK_MESSAGE_DELAY_MS, onSent, onError } = {},
  ) {
    if (!Array.isArray(recipients) || recipients.length === 0) {
      return {
        total: 0,
        sent: 0,
        failed: 0,
        results: [],
      };
    }

    if (this.bulkSending) {
      throw new Error("A bulk message send is already in progress.");
    }

    /*
     * Never allow a caller to reduce the delay below 6 seconds.
     *
     * Examples:
     *
     * delayMs = 0       -> 6000
     * delayMs = 1000    -> 6000
     * delayMs = 6000    -> 6000
     * delayMs = 10000   -> 10000
     */
    const requestedDelay = Number(delayMs);

    const safeDelay =
      Number.isFinite(requestedDelay) && requestedDelay >= BULK_MESSAGE_DELAY_MS
        ? requestedDelay
        : BULK_MESSAGE_DELAY_MS;

    let sent = 0;
    let failed = 0;

    const results = [];

    this.bulkSending = true;

    try {
      for (let index = 0; index < recipients.length; index += 1) {
        const originalJid = recipients[index];

        const destination = jidNormalizedUser(originalJid) || originalJid;

        if (!destination) {
          failed += 1;

          const result = {
            index,
            jid: originalJid,
            success: false,
            error: "Invalid recipient JID",
          };

          results.push(result);

          if (typeof onError === "function") {
            try {
              await onError(result.error, result);
            } catch {
              /*
               * Callback failures must never stop
               * the bulk send.
               */
            }
          }

          continue;
        }

        /*
         * Wait ONLY between recipients.
         *
         * First recipient:
         *   send immediately.
         *
         * Every following recipient:
         *   wait at least 6 seconds,
         *   then send.
         */
        if (index > 0) {
          await sleep(safeDelay);
        }

        try {
          const payload =
            typeof payloadFactory === "function"
              ? await payloadFactory(destination, index)
              : payloadFactory;

          if (!payload) {
            throw new Error("Bulk message payload is empty");
          }

          /*
           * Exactly ONE send operation at a time.
           */
          await this.#sendResult(destination, destination, payload, undefined);

          sent += 1;

          const result = {
            index,
            jid: destination,
            success: true,
          };

          results.push(result);

          if (typeof onSent === "function") {
            try {
              await onSent(destination, result);
            } catch {
              /*
               * Callback failures must never stop
               * the bulk send.
               */
            }
          }
        } catch (error) {
          failed += 1;

          const errorMessage =
            error instanceof Error ? error.message : String(error);

          const result = {
            index,
            jid: destination,
            success: false,
            error: errorMessage,
          };

          results.push(result);

          console.error(
            `[BulkMessage] Failed to send to ${destination}:`,
            error,
          );

          if (typeof onError === "function") {
            try {
              await onError(error, result);
            } catch {
              /*
               * Callback failures must never stop
               * the bulk send.
               */
            }
          }
        }
      }

      return {
        total: recipients.length,
        sent,
        failed,
        results,
      };
    } finally {
      /*
       * Always release the bulk lock, even when an
       * unexpected exception happens.
       */
      this.bulkSending = false;
    }
  }

  async #resolveActorJid(message, remoteJid) {
    const group = isGroupJid(remoteJid);

    const candidates = [];

    const add = (jid) => {
      if (!jid) {
        return;
      }

      const normalized = jidNormalizedUser(jid);

      if (normalized && !candidates.includes(normalized)) {
        candidates.push(normalized);
      }
    };

    /*
     * Collect every identity Baileys can give us.
     *
     * senderPn / participantPn are useful in LID situations.
     */
    if (group) {
      add(message.key?.participant);
      add(message.key?.participantAlt);
      add(message.key?.participantPn);
      add(message.key?.senderPn);
    } else {
      add(message.key?.remoteJid);
      add(message.key?.remoteJidAlt);
      add(message.key?.senderPn);
    }

    if (!candidates.length) {
      return null;
    }

    /*
     * First: direct database match.
     */
    for (const candidate of candidates) {
      const member = this.members.getByJid(candidate);

      if (member) {
        /*
         * Always use the database's canonical identity
         * where one exists. This makes the flow stable.
         */
        return jidNormalizedUser(member.whatsappJid) || candidate;
      }
    }

    /*
     * Second: resolve all LIDs through Baileys.
     */
    for (const candidate of candidates) {
      const resolved = await this.whatsapp.resolveJid(candidate);

      if (!resolved) {
        continue;
      }

      const member = this.members.getByJid(resolved);

      if (member) {
        return jidNormalizedUser(member.whatsappJid) || resolved;
      }
    }

    /*
     * Third: use a PN supplied directly by WhatsApp for
     * a new registration.
     */
    const pn = candidates.find((candidate) => isPnUser(candidate));

    if (pn) {
      return pn;
    }

    /*
     * Fourth: keep whatever identity WhatsApp supplied.
     */
    return candidates[0];
  }

  async #memberForMessage(message, actorJid) {
    const candidates = [];

    const add = (jid) => {
      if (!jid) {
        return;
      }

      const normalized = jidNormalizedUser(jid) || jid;

      if (normalized && !candidates.includes(normalized)) {
        candidates.push(normalized);
      }
    };

    add(actorJid);

    add(message.key?.remoteJid);
    add(message.key?.remoteJidAlt);
    add(message.key?.participant);
    add(message.key?.participantAlt);
    add(message.key?.participantPn);
    add(message.key?.senderPn);

    /*
     * Direct match.
     */
    for (const candidate of candidates) {
      const member = this.members.getByJid(candidate);

      if (member) {
        return member;
      }
    }

    /*
     * LID -> PN fallback.
     */
    for (const candidate of candidates) {
      const resolved = await this.whatsapp.resolveJid(candidate);

      if (!resolved) {
        continue;
      }

      const member = this.members.getByJid(resolved);

      if (member) {
        return member;
      }
    }

    return null;
  }

  #replyDestination(remoteJid, actorJid, id) {
    const privateOnly = new Set([
      "member:view",
      "member:register",
      "member:update",
      "member:reference",
      "member:reminders",
      "member:delete",
      "member:delete_yes",
      "member:delete_no",
      "reminders:on",
      "reminders:off",
      "registration:cancel",
      "registration:keep-name",
      "registration:change-name",
      "registration:use-number",
      "registration:change-number",
      "registration:confirm",
      "registration:edit",
    ]);

    if (isGroupJid(remoteJid) && privateOnly.has(id)) {
      return actorJid;
    }

    return remoteJid;
  }

  #text(message) {
    const content = message.message || {};

    return (
      content.conversation ||
      content.extendedTextMessage?.text ||
      content.imageMessage?.caption ||
      content.videoMessage?.caption ||
      ""
    );
  }

  #interaction(message) {
    const native =
      message.message?.interactiveResponseMessage?.nativeFlowResponseMessage;

    if (native?.paramsJson) {
      try {
        const parsed = JSON.parse(native.paramsJson);

        return {
          id:
            parsed.id ||
            parsed.row_id ||
            parsed.selected_id ||
            parsed.button_id ||
            null,

          displayText: parsed.display_text || null,
        };
      } catch {
        return null;
      }
    }

    const nativeDirect = message.message?.nativeFlowResponseMessage;

    if (nativeDirect?.paramsJson) {
      try {
        const parsed = JSON.parse(nativeDirect.paramsJson);

        return {
          id:
            parsed.id ||
            parsed.row_id ||
            parsed.selected_id ||
            parsed.button_id ||
            null,

          displayText: parsed.display_text || null,
        };
      } catch {
        return null;
      }
    }

    const button =
      message.message?.buttonsResponseMessage?.selectedButtonId ||
      message.message?.listResponseMessage?.singleSelectReply?.selectedRowId ||
      message.message?.templateButtonReplyMessage?.selectedId;

    return button ? { id: button } : null;
  }

  async #menuAction(id, remoteJid, actorJid, quoted) {
    const member = await this.#memberForMessage(quoted, actorJid);

    const destination = this.#replyDestination(remoteJid, actorJid, id);

    const send = (payload) =>
      this.#sendResult(
        destination,
        actorJid,
        payload,
        destination === remoteJid ? quoted : undefined,
      );

    if (id === "member:view") {
      return send(
        member
          ? {
              kind: "text",

              text:
                `Your membership details.\n\n` +
                `Name: ${member.fullName}\n` +
                `WhatsApp: +${member.phone}\n` +
                `Reference: ${member.code}\n` +
                `Reminders: ${member.remindersEnabled ? "On" : "Off"}`,
            }
          : {
              kind: "text",

              text:
                `I do not have a completed membership record for this WhatsApp number.\n\n` +
                `Please send ${this.settings().keyword} to begin.`,
            },
      );
    }

    if (id === "member:register") {
      return send(this.flow.start(actorJid, "register"));
    }

    if (id === "member:update") {
      return send(this.flow.start(actorJid, "update"));
    }

    if (id === "member:reference") {
      return send(
        member
          ? {
              kind: "reference",
              member,

              intro:
                `✅ Your membership details are ready.\n\n` +
                `Reference: ${member.code}`,

              footer: this.settings().botFooter,
            }
          : {
              kind: "text",

              text: "I cannot find a completed membership record for this WhatsApp number.",
            },
      );
    }

    if (id === "member:reminders") {
      return send(
        member
          ? {
              kind: "interactive",

              text:
                `Reminder settings for ${member.firstName}.\n\n` +
                `Choose whether you would like to receive gathering reminders.`,

              footer: this.settings().botFooter,

              buttons: [
                this.whatsapp.renderer.quickReply(
                  "Turn reminders on",
                  "reminders:on",
                ),

                this.whatsapp.renderer.quickReply(
                  "Turn reminders off",
                  "reminders:off",
                ),

                this.whatsapp.renderer.quickReply("Close", "menu:close"),
              ],
            }
          : {
              kind: "text",

              text: "Please register first.",
            },
      );
    }

    if (id === "reminders:on" || id === "reminders:off") {
      if (!member) {
        return send({
          kind: "text",

          text: "Please register first.",
        });
      }

      const enabled = id.endsWith(":on");

      await this.members.setReminders(member.id, enabled);

      return send({
        kind: "text",

        text: `✅ Your reminders are now ${enabled ? "on" : "off"}.`,
      });
    }

    if (id === "member:delete") {
      return send(
        member
          ? {
              kind: "interactive",

              text:
                `You are about to remove your membership record.\n\n` +
                `Reference: ${member.code}\n\n` +
                `This action will deactivate your membership.`,

              footer: this.settings().botFooter,

              buttons: [
                this.whatsapp.renderer.quickReply(
                  "Delete membership",
                  "member:delete_yes",
                ),

                this.whatsapp.renderer.quickReply(
                  "Keep membership",
                  "member:delete_no",
                ),
              ],
            }
          : {
              kind: "text",

              text: "No completed membership record was found.",
            },
      );
    }

    if (id === "member:delete_yes") {
      if (!member) {
        return send({
          kind: "text",

          text: "No completed membership record was found.",
        });
      }

      const deleted = await this.members.deleteSelf(member.id);

      return send({
        kind: "interactive",

        text:
          `✅ Membership removed successfully.\n\n` +
          `Reference ${deleted.code} has been retired.\n\n` +
          `You can register again whenever you are ready.`,

        footer: this.settings().botFooter,

        buttons: [
          this.whatsapp.renderer.quickReply(
            "Register again",
            "member:register",
          ),

          this.whatsapp.renderer.quickReply("Open menu", "open:main"),
        ],
      });
    }

    if (id === "member:delete_no") {
      return send({
        kind: "text",

        text: "✅ No changes were made. Your membership remains active.",
      });
    }

    if (id === "menu:close") {
      return send({
        kind: "text",

        text: `Menu closed. Send ${this.settings().keyword} whenever you need it again.`,
      });
    }

    if (id === "event:transport") {
      return send({
        kind: "text",

        text:
          `${this.settings().transportNotice}\n\n` +
          `Please follow the organisers' travel instructions shared through this service.`,
      });
    }

    if (id === "event:details") {
      return send({
        kind: "text",

        text:
          `Gathering: ${this.settings().eventName}\n` +
          `Location: ${this.settings().eventLocation}\n\n` +
          `${this.settings().transportNotice}`,
      });
    }

    if (id === "help") {
      return send({
        kind: "text",

        text: `Send ${this.settings().keyword} to open the member menu at any time.`,
      });
    }

    if (id?.startsWith("open:")) {
      return send(this.menu.main(member));
    }

    return send({
      kind: "text",

      text:
        `I could not complete that action.\n\n` +
        `Send ${this.settings().keyword} to open the menu again.`,
    });
  }

  async #sendResult(remoteJid, actorJid, payload, quoted) {
    if (!payload) {
      return;
    }

    const destination = remoteJid || actorJid;

    if (!destination) {
      return;
    }

    if (payload.kind === "interactive-menu") {
      return this.whatsapp.sendMenu(destination, payload, quoted);
    }

    if (payload.kind === "reference") {
      return this.whatsapp.sendReference(
        destination,
        {
          name: payload.member.fullName,

          phone: payload.member.phone,

          code: payload.member.code,

          footer: payload.footer,

          intro: payload.intro,
        },
        quoted,
      );
    }

    return this.whatsapp.sendToJid(destination, payload, {
      quoted,
    });
  }
}
