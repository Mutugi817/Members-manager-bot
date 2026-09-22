import { isPnUser, jidNormalizedUser } from "@whiskeysockets/baileys";

import { cleanText, isGroupJid } from "../core/utils.js";

/*
 * ============================================================================
 * BULK MESSAGE SAFETY
 * ============================================================================
 *
 * This is the minimum interval between ACTUAL outbound bulk send attempts.
 *
 * First message:
 *   send immediately
 *
 * Next message:
 *   at least 6 seconds after the previous send started
 *
 * The value can never be reduced below this minimum.
 *
 * This is intended to prevent accidental application-level message bursts.
 * It is not an anti-detection mechanism.
 */
const MIN_BULK_MESSAGE_DELAY_MS = 6000;

/*
 * Prevent an unreasonably large number of recipients from being handled
 * accidentally because of a malformed payload or database query.
 *
 * Set to 0 to disable this application-level guard.
 */
const MAX_BULK_RECIPIENTS = 5000;

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function normalizeJid(jid) {
  if (!jid) {
    return null;
  }

  const value = String(jid).trim();

  if (!value) {
    return null;
  }

  return jidNormalizedUser(value) || value;
}

function isProbablyValidJid(jid) {
  if (!jid) {
    return false;
  }

  /*
   * We intentionally keep this check conservative.
   *
   * Baileys supports different JID forms, so we do not try to
   * invent a stricter JID parser here.
   */
  return jid.includes("@") || /^\d+$/.test(jid);
}

function nowMs() {
  return Date.now();
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
     * ------------------------------------------------------------------------
     * BULK QUEUE STATE
     * ------------------------------------------------------------------------
     *
     * `bulkQueueTail` is a promise representing the end of the currently
     * queued bulk operations.
     *
     * This means if code calls:
     *
     *   sendBulkMessages(A)
     *   sendBulkMessages(B)
     *   sendBulkMessages(C)
     *
     * the jobs become:
     *
     *   A -> B -> C
     *
     * rather than:
     *
     *   A + B + C simultaneously.
     */
    this.bulkQueueTail = Promise.resolve();

    /*
     * Whether a job is currently actively sending.
     */
    this.bulkSending = false;

    /*
     * Current active bulk job.
     *
     * This contains only local execution state.
     */
    this.activeBulkJob = null;

    /*
     * Identifier assigned to every bulk job.
     */
    this.nextBulkJobId = 1;

    /*
     * Timestamp at which the previous actual outbound bulk message
     * started.
     *
     * This is deliberately preserved between bulk jobs so a newly started
     * broadcast cannot immediately follow the last message of the previous
     * broadcast.
     */
    this.lastBulkSendAt = 0;
  }

  /*
   * ==========================================================================
   * INCOMING MESSAGE HANDLING
   * ==========================================================================
   */

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
   * ==========================================================================
   * STOP ACTIVE BULK MESSAGE
   * ==========================================================================
   *
   * This stops the active job before its next recipient.
   *
   * A message already passed to Baileys cannot be retroactively cancelled.
   */
  stopBulkMessages() {
    if (!this.bulkSending || !this.activeBulkJob) {
      return false;
    }

    this.activeBulkJob.stopRequested = true;

    return true;
  }

  /*
   * ==========================================================================
   * BULK STATUS
   * ==========================================================================
   */

  getBulkStatus() {
    const job = this.activeBulkJob;

    return {
      sending: this.bulkSending,

      jobId: job?.id ?? null,

      queuedAt: job?.queuedAt ?? null,

      startedAt: job?.startedAt ?? null,

      stopRequested: Boolean(job?.stopRequested),

      currentIndex: job?.currentIndex ?? null,

      total: job?.total ?? 0,

      sent: job?.sent ?? 0,

      failed: job?.failed ?? 0,

      skipped: job?.skipped ?? 0,

      lastBulkSendAt: this.lastBulkSendAt || null,
    };
  }

  /*
   * ==========================================================================
   * BULK MESSAGE SENDING
   * ==========================================================================
   *
   * This is intentionally a QUEUED operation.
   *
   * Calling this multiple times does not create concurrent broadcasts.
   *
   * Example:
   *
   *   await handler.sendBulkMessages(A, payload);
   *   await handler.sendBulkMessages(B, payload);
   *
   * becomes:
   *
   *   A completely finishes
   *            ↓
   *   B completely finishes
   *
   * And even when the calls are initiated without awaiting them:
   *
   *   const a = handler.sendBulkMessages(A, payload);
   *   const b = handler.sendBulkMessages(B, payload);
   *
   * the internal queue still serializes them.
   */
  async sendBulkMessages(
    recipients,
    payloadFactory,
    { delayMs = MIN_BULK_MESSAGE_DELAY_MS, onSent, onError, onSkipped } = {},
  ) {
    if (!Array.isArray(recipients) || recipients.length === 0) {
      return {
        total: 0,
        requested: 0,
        sent: 0,
        failed: 0,
        skipped: 0,
        stopped: false,
        results: [],
      };
    }

    if (MAX_BULK_RECIPIENTS > 0 && recipients.length > MAX_BULK_RECIPIENTS) {
      throw new Error(
        `Bulk recipient count ${recipients.length} exceeds the configured maximum of ${MAX_BULK_RECIPIENTS}.`,
      );
    }

    /*
     * We accept a larger delay, but never a smaller one.
     */
    const requestedDelay = Number(delayMs);

    const minimumInterval =
      Number.isFinite(requestedDelay) &&
      requestedDelay >= MIN_BULK_MESSAGE_DELAY_MS
        ? requestedDelay
        : MIN_BULK_MESSAGE_DELAY_MS;

    /*
     * Capture the recipients and options in a job-local object.
     */
    const job = {
      id: this.nextBulkJobId++,

      queuedAt: new Date().toISOString(),

      startedAt: null,

      stopRequested: false,

      currentIndex: -1,

      total: 0,

      sent: 0,

      failed: 0,

      skipped: 0,
    };

    /*
     * ------------------------------------------------------------------------
     * IMPORTANT
     * ------------------------------------------------------------------------
     *
     * Each queued job is attached to the previous queue tail.
     *
     * The `.catch()` ensures one unexpected internal failure does not
     * permanently poison the queue for all future broadcasts.
     */
    const runJob = this.bulkQueueTail
      .catch(() => {})
      .then(() =>
        this.#runBulkMessages(job, recipients, payloadFactory, {
          minimumInterval,
          onSent,
          onError,
          onSkipped,
        }),
      );

    this.bulkQueueTail = runJob.catch(() => {});

    return runJob;
  }

  /*
   * ==========================================================================
   * INTERNAL BULK WORKER
   * ==========================================================================
   */

  async #runBulkMessages(
    job,
    recipients,
    payloadFactory,
    { minimumInterval, onSent, onError, onSkipped },
  ) {
    /*
     * ------------------------------------------------------------------------
     * NORMALIZE AND DEDUPLICATE RECIPIENTS
     * ------------------------------------------------------------------------
     */

    const uniqueRecipients = [];

    const seen = new Set();

    for (const recipient of recipients) {
      const original = recipient;

      let possibleJid = null;

      if (typeof recipient === "string") {
        possibleJid = recipient;
      } else if (recipient && typeof recipient === "object") {
        possibleJid = recipient.jid || recipient.whatsappJid || recipient.phone;
      }

      const jid = normalizeJid(possibleJid);

      if (!jid) {
        continue;
      }

      if (!isProbablyValidJid(jid)) {
        continue;
      }

      if (seen.has(jid)) {
        continue;
      }

      seen.add(jid);

      uniqueRecipients.push({
        original,
        jid,
      });
    }

    job.total = uniqueRecipients.length;

    /*
     * Make the job active only after it reaches the head of the queue.
     */
    this.bulkSending = true;

    this.activeBulkJob = job;

    job.startedAt = new Date().toISOString();

    const results = [];

    try {
      for (let index = 0; index < uniqueRecipients.length; index += 1) {
        job.currentIndex = index;

        /*
         * --------------------------------------------------------------
         * STOP CHECK
         * --------------------------------------------------------------
         */
        if (job.stopRequested) {
          break;
        }

        const entry = uniqueRecipients[index];

        const destination = entry.jid;

        /*
         * --------------------------------------------------------------
         * CREATE PAYLOAD
         * --------------------------------------------------------------
         *
         * We create the payload before waiting so that asynchronous
         * payload generation does not accidentally cause an additional
         * uncontrolled delay after the interval begins.
         */
        let payload;

        try {
          payload =
            typeof payloadFactory === "function"
              ? await payloadFactory(destination, index, entry.original)
              : payloadFactory;
        } catch (error) {
          job.failed += 1;

          const result = {
            index,
            jid: destination,
            success: false,
            skipped: false,
            error: error instanceof Error ? error.message : String(error),
          };

          results.push(result);

          console.error(
            `[BulkMessage:${job.id}] Failed to build payload for ${destination}:`,
            error,
          );

          await this.#callBulkCallback(onError, error, result);

          continue;
        }

        /*
         * --------------------------------------------------------------
         * EMPTY PAYLOAD
         * --------------------------------------------------------------
         *
         * Do not contact WhatsApp with an empty payload.
         */
        if (!payload) {
          job.skipped += 1;

          const result = {
            index,
            jid: destination,
            success: false,
            skipped: true,
            reason: "Empty message payload",
          };

          results.push(result);

          await this.#callBulkCallback(onSkipped, destination, result);

          continue;
        }

        /*
         * --------------------------------------------------------------
         * INTERVAL CONTROL
         * --------------------------------------------------------------
         *
         * We measure the time from the START of the previous actual
         * outbound send.
         *
         * This means:
         *
         * previous send starts at 12:00:00
         *
         * next send may not start before:
         *
         * 12:00:06
         *
         * If a send itself takes 2 seconds, we wait another 4.
         * If it takes 8 seconds, we do not wait an additional 6.
         */
        const elapsed = nowMs() - this.lastBulkSendAt;

        const remaining = minimumInterval - elapsed;

        if (this.lastBulkSendAt > 0 && remaining > 0) {
          await sleep(remaining);
        }

        /*
         * The job could have been stopped during the wait.
         */
        if (job.stopRequested) {
          break;
        }

        /*
         * --------------------------------------------------------------
         * SEND
         * --------------------------------------------------------------
         *
         * Record the start time immediately before the actual send.
         *
         * This is the critical serialization point.
         */
        this.lastBulkSendAt = nowMs();

        try {
          /*
           * EXACTLY ONE outbound send.
           *
           * No Promise.all().
           * No Promise.race().
           * No parallel map().
           */
          await this.#sendResult(destination, destination, payload, undefined);

          job.sent += 1;

          const result = {
            index,
            jid: destination,
            success: true,
            skipped: false,
          };

          results.push(result);

          console.log(
            `[BulkMessage:${job.id}] Sent ${index + 1}/${uniqueRecipients.length} -> ${destination}`,
          );

          await this.#callBulkCallback(onSent, destination, result);
        } catch (error) {
          job.failed += 1;

          const errorMessage =
            error instanceof Error ? error.message : String(error);

          const result = {
            index,
            jid: destination,
            success: false,
            skipped: false,
            error: errorMessage,
          };

          results.push(result);

          console.error(
            `[BulkMessage:${job.id}] Failed to send to ${destination}:`,
            error,
          );

          /*
           * ------------------------------------------------------------
           * NO BLIND RETRY
           * ------------------------------------------------------------
           *
           * We intentionally do not retry here.
           *
           * A transport failure does not always tell us whether the
           * remote service accepted the message before the error
           * occurred. An automatic retry could therefore duplicate
           * a message.
           */
          await this.#callBulkCallback(onError, error, result);
        }
      }

      return {
        jobId: job.id,

        total: uniqueRecipients.length,

        requested: recipients.length,

        sent: job.sent,

        failed: job.failed,

        skipped: job.skipped,

        stopped: job.stopRequested,

        startedAt: job.startedAt,

        completedAt: new Date().toISOString(),

        results,
      };
    } finally {
      /*
       * Release the active-job state no matter how the operation ends.
       *
       * Do not clear lastBulkSendAt because it protects the boundary
       * between this job and the next queued job.
       */
      this.bulkSending = false;

      this.activeBulkJob = null;
    }
  }

  /*
   * ==========================================================================
   * SAFE CALLBACK EXECUTION
   * ==========================================================================
   *
   * A UI/progress callback must never be able to break the message queue.
   */
  async #callBulkCallback(callback, ...args) {
    if (typeof callback !== "function") {
      return;
    }

    try {
      await callback(...args);
    } catch (error) {
      console.warn("[BulkMessage] Callback failed:", error);
    }
  }

  /*
   * ==========================================================================
   * ACTOR JID RESOLUTION
   * ==========================================================================
   */

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

  /*
   * ==========================================================================
   * MEMBER RESOLUTION
   * ==========================================================================
   */

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

  /*
   * ==========================================================================
   * REPLY DESTINATION
   * ==========================================================================
   */

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

  /*
   * ==========================================================================
   * TEXT EXTRACTION
   * ==========================================================================
   */

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

  /*
   * ==========================================================================
   * INTERACTION EXTRACTION
   * ==========================================================================
   */

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

    return button
      ? {
          id: button,
        }
      : null;
  }

  /*
   * ==========================================================================
   * MENU ACTIONS
   * ==========================================================================
   */

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

    /*
     * ------------------------------------------------------------------------
     * MEMBER VIEW
     * ------------------------------------------------------------------------
     */

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

    /*
     * ------------------------------------------------------------------------
     * MEMBER REGISTRATION
     * ------------------------------------------------------------------------
     */

    if (id === "member:register") {
      return send(this.flow.start(actorJid, "register"));
    }

    /*
     * ------------------------------------------------------------------------
     * MEMBER UPDATE
     * ------------------------------------------------------------------------
     */

    if (id === "member:update") {
      return send(this.flow.start(actorJid, "update"));
    }

    /*
     * ------------------------------------------------------------------------
     * MEMBER REFERENCE
     * ------------------------------------------------------------------------
     */

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

    /*
     * ------------------------------------------------------------------------
     * MEMBER REMINDERS
     * ------------------------------------------------------------------------
     */

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

    /*
     * ------------------------------------------------------------------------
     * REMINDERS TOGGLE
     * ------------------------------------------------------------------------
     */

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

    /*
     * ------------------------------------------------------------------------
     * MEMBER DELETE CONFIRMATION
     * ------------------------------------------------------------------------
     */

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

    /*
     * ------------------------------------------------------------------------
     * MEMBER DELETE YES
     * ------------------------------------------------------------------------
     */

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

    /*
     * ------------------------------------------------------------------------
     * MEMBER DELETE NO
     * ------------------------------------------------------------------------
     */

    if (id === "member:delete_no") {
      return send({
        kind: "text",

        text: "✅ No changes were made. Your membership remains active.",
      });
    }

    /*
     * ------------------------------------------------------------------------
     * CLOSE MENU
     * ------------------------------------------------------------------------
     */

    if (id === "menu:close") {
      return send({
        kind: "text",

        text: `Menu closed. Send ${this.settings().keyword} whenever you need it again.`,
      });
    }

    /*
     * ------------------------------------------------------------------------
     * TRANSPORT
     * ------------------------------------------------------------------------
     */

    if (id === "event:transport") {
      return send({
        kind: "text",

        text:
          `${this.settings().transportNotice}\n\n` +
          `Please follow the organisers' travel instructions shared through this service.`,
      });
    }

    /*
     * ------------------------------------------------------------------------
     * EVENT DETAILS
     * ------------------------------------------------------------------------
     */

    if (id === "event:details") {
      return send({
        kind: "text",

        text:
          `Gathering: ${this.settings().eventName}\n` +
          `Location: ${this.settings().eventLocation}\n\n` +
          `${this.settings().transportNotice}`,
      });
    }

    /*
     * ------------------------------------------------------------------------
     * HELP
     * ------------------------------------------------------------------------
     */

    if (id === "help") {
      return send({
        kind: "text",

        text: `Send ${this.settings().keyword} to open the member menu at any time.`,
      });
    }

    /*
     * ------------------------------------------------------------------------
     * OPEN MENU
     * ------------------------------------------------------------------------
     */

    if (id?.startsWith("open:")) {
      return send(this.menu.main(member));
    }

    /*
     * ------------------------------------------------------------------------
     * UNKNOWN ACTION
     * ------------------------------------------------------------------------
     */

    return send({
      kind: "text",

      text:
        `I could not complete that action.\n\n` +
        `Send ${this.settings().keyword} to open the menu again.`,
    });
  }

  /*
   * ==========================================================================
   * RESULT DISPATCHER
   * ==========================================================================
   */

  async #sendResult(remoteJid, actorJid, payload, quoted) {
    if (!payload) {
      return;
    }

    const destination = remoteJid || actorJid;

    if (!destination) {
      return;
    }

    /*
     * Interactive menu.
     */
    if (payload.kind === "interactive-menu") {
      return this.whatsapp.sendMenu(destination, payload, quoted);
    }

    /*
     * Membership reference.
     */
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

    /*
     * Normal text/image/etc. payload.
     */
    return this.whatsapp.sendToJid(destination, payload, {
      quoted,
    });
  }
}
