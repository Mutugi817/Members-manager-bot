import { sleep, formatPhone } from "../core/utils.js";

/*
 * ============================================================================
 * OUTBOUND DELIVERY POLICY
 * ============================================================================
 *
 * One actual outbound bulk attempt at a time.
 *
 * After an outbound attempt COMPLETES:
 *
 *     wait 6 seconds
 *
 * before the next outbound attempt.
 *
 * Every 50 targets:
 *
 *     wait 10 minutes
 *
 * before beginning the next batch.
 *
 * These values are intentionally fixed. They are application-level pacing
 * controls and are not intended to bypass WhatsApp enforcement.
 */
const MIN_OUTBOUND_INTERVAL_MS = 6000;

const BATCH_SIZE = 50;

const BATCH_DELAY_MS = 10 * 60 * 1000;

const MAX_CONSECUTIVE_FAILURES = 3;

const FAILURE_COOLDOWN_MS = 60 * 1000;

/*
 * ============================================================================
 * PROCESS-WIDE QUEUE STATE
 * ============================================================================
 *
 * These variables live outside the class.
 *
 * Therefore, if your dependency container accidentally creates two
 * OutreachService instances, they still share the same outbound queue.
 *
 * This prevents:
 *
 *     OutreachService A -> send()
 *     OutreachService B -> send()
 *
 * from happening concurrently inside the same Node.js process.
 *
 * NOTE:
 * This does not coordinate separate Node.js processes or separate machines.
 * For a multi-process deployment, the queue must be moved to a shared durable
 * queue/lock such as Redis or PostgreSQL.
 */
let processQueueTail = Promise.resolve();

let lastOutboundCompletedAt = 0;

let processCooldownUntil = 0;

/*
 * ============================================================================
 * HELPERS
 * ============================================================================
 */

function now() {
  return Date.now();
}

function stringValue(value) {
  return String(value ?? "").trim();
}

function normalizeTargetKey(target) {
  if (target && typeof target === "object") {
    /*
     * Prefer the actual WhatsApp identity.
     *
     * This is important because two member records may have different
     * internal database IDs while pointing at the same phone number.
     */
    const whatsappJid = stringValue(target.whatsappJid);

    if (whatsappJid) {
      return whatsappJid.toLowerCase();
    }

    const jid = stringValue(target.jid);

    if (jid) {
      return jid.toLowerCase();
    }

    const phone = stringValue(target.phone);

    if (phone) {
      /*
       * Remove formatting so:
       *
       *   0787 720 812
       *
       * and:
       *
       *   0787720812
       *
       * become the same deduplication key.
       */
      return phone.replace(/\D/g, "");
    }

    const id = stringValue(target.id);

    return id ? id.toLowerCase() : "";
  }

  const value = stringValue(target);

  if (!value) {
    return "";
  }

  if (value.includes("@")) {
    return value.toLowerCase();
  }

  return value.replace(/\D/g, "");
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

/*
 * ============================================================================
 * PROCESS-WIDE SERIALIZATION
 * ============================================================================
 */

async function waitForOutboundSlot() {
  while (true) {
    const current = now();

    const intervalRemaining =
      lastOutboundCompletedAt > 0
        ? MIN_OUTBOUND_INTERVAL_MS - (current - lastOutboundCompletedAt)
        : 0;

    const cooldownRemaining =
      processCooldownUntil > current ? processCooldownUntil - current : 0;

    const waitFor = Math.max(0, intervalRemaining, cooldownRemaining);

    if (waitFor <= 0) {
      return;
    }

    await sleep(waitFor);
  }
}

function recordOutboundCompletion() {
  lastOutboundCompletedAt = now();
}

/*
 * ============================================================================
 * OUTREACH SERVICE
 * ============================================================================
 */

export class OutreachService {
  constructor({ whatsapp, members, config, settings }) {
    this.whatsapp = whatsapp;

    this.members = members;

    this.config = config;

    this.settings = settings;

    /*
     * Instance-level queue reference.
     *
     * The real synchronization is process-wide above, but retaining an
     * instance queue also ensures calls made through the same service remain
     * ordered naturally.
     */
    this.queueTail = Promise.resolve();

    /*
     * Kept for compatibility with code that may inspect this service.
     *
     * This represents the last completed outbound attempt rather than the
     * previous implementation's "started" timestamp.
     */
    this.lastSendCompletedAt = 0;

    this.cooldownUntil = 0;
  }

  /*
   * ==========================================================================
   * PAYLOADS
   * ==========================================================================
   */

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

  /*
   * ==========================================================================
   * MEMBER NOTIFICATION
   * ==========================================================================
   */

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

        error: errorMessage(error),
      }),
    );
  }

  /*
   * ==========================================================================
   * CAMPAIGN
   * ==========================================================================
   */

  async sendCampaign({ targetType, targetIds, payload }) {
    /*
     * ------------------------------------------------------------------------
     * GROUP CAMPAIGN
     * ------------------------------------------------------------------------
     */

    if (
      targetType === "group" ||
      targetType === "groups" ||
      targetType === "all_groups"
    ) {
      const groups = await this.whatsapp.groups();

      const ids = Array.isArray(targetIds) ? targetIds : [];

      let chosen;

      if (targetType === "all_groups") {
        chosen = groups;
      } else {
        const wanted = new Set(ids.map((id) => String(id)));

        chosen = groups.filter((group) => wanted.has(String(group.id)));
      }

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

          error: errorMessage(error),
        }),
      );
    }

    /*
     * ------------------------------------------------------------------------
     * MEMBER CAMPAIGN
     * ------------------------------------------------------------------------
     */

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

        error: errorMessage(error),
      }),
    );
  }

  /*
   * ==========================================================================
   * PUBLIC QUEUE ENTRY
   * ==========================================================================
   */

  async #enqueueBulk(targets, sender, failureResult) {
    const unique = this.#deduplicate(targets);

    if (!unique.length) {
      return [];
    }

    /*
     * Every bulk job waits for the previous bulk job.
     *
     * `.catch(() => {})` prevents an unexpected rejected job from poisoning
     * the queue forever.
     */
    const job = this.queueTail
      .catch(() => {})
      .then(() => this.#runBulk(unique, sender, failureResult));

    this.queueTail = job.catch(() => {});

    /*
     * Also update the process-wide queue.
     *
     * This is the important protection if more than one service instance
     * exists in the application.
     */
    processQueueTail = processQueueTail.catch(() => {}).then(() => job);

    return processQueueTail;
  }

  /*
   * ==========================================================================
   * DEDUPLICATION
   * ==========================================================================
   */

  #deduplicate(targets) {
    const seen = new Set();

    const result = [];

    for (const target of targets) {
      const key = normalizeTargetKey(target);

      /*
       * Never enqueue a target whose identity cannot be established.
       */
      if (!key) {
        continue;
      }

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);

      result.push(target);
    }

    return result;
  }

  /*
   * ==========================================================================
   * SINGLE BULK JOB
   * ==========================================================================
   */

  async #runBulk(targets, sender, failureResult) {
    const results = [];

    /*
     * Build batches.
     *
     * 1..50
     * 51..100
     * 101..150
     * ...
     */
    const batches = [];

    for (let index = 0; index < targets.length; index += BATCH_SIZE) {
      batches.push(targets.slice(index, index + BATCH_SIZE));
    }

    /*
     * Respect any cooldown left by a previous failed job.
     */
    await waitForOutboundSlot();

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
      const batch = batches[batchIndex];

      let consecutiveFailures = 0;

      console.log(
        `[Outreach] Starting batch ${batchIndex + 1}/${batches.length} (${batch.length} target(s)).`,
      );

      for (let index = 0; index < batch.length; index += 1) {
        const target = batch[index];

        /*
         * --------------------------------------------------------------------
         * WAIT FOR BOTH:
         *
         * 1. Six seconds after the previous outbound attempt completed.
         *
         * 2. Any active failure cooldown.
         * --------------------------------------------------------------------
         */
        await waitForOutboundSlot();

        const absoluteIndex = batchIndex * BATCH_SIZE + index;

        const startedAt = now();

        console.log(
          `[Outreach] Sending ${absoluteIndex + 1}/${targets.length}.`,
        );

        let sendCompleted = false;

        try {
          /*
           * ------------------------------------------------------------------
           * ONE AND ONLY ONE OUTBOUND SEND
           * ------------------------------------------------------------------
           *
           * Never Promise.all().
           * Never .map(async ...).
           * Never launch another sender without awaiting this one.
           */
          const result = await sender(target, index);

          results.push(result);

          consecutiveFailures = 0;

          sendCompleted = true;

          const completedAt = now();

          this.lastSendCompletedAt = completedAt;

          /*
           * This is the critical fix.
           *
           * The six-second interval starts HERE, after sender() resolves.
           */
          recordOutboundCompletion();

          console.log(
            `[Outreach] Completed ${absoluteIndex + 1}/${targets.length}. ` +
              `Send duration ${completedAt - startedAt}ms. ` +
              `Next outbound send will wait at least ${MIN_OUTBOUND_INTERVAL_MS}ms.`,
          );
        } catch (error) {
          /*
           * A failed outbound attempt still counts for pacing.
           *
           * This prevents immediate consecutive retry-like traffic.
           */
          recordOutboundCompletion();

          this.lastSendCompletedAt = now();

          consecutiveFailures += 1;

          const result = failureResult(target, error);

          results.push(result);

          console.error(`[Outreach] Send failed for target:`, error);

          /*
           * ------------------------------------------------------------------
           * CRITICAL ERROR
           * ------------------------------------------------------------------
           *
           * Stop rather than continuing to fire outbound requests after
           * a serious connection/rate/authentication failure.
           */
          if (this.#isCriticalError(error)) {
            this.#activateCooldown(FAILURE_COOLDOWN_MS);

            console.error(
              `[Outreach] Critical outbound error. ` +
                `Stopping current bulk job and cooling down for ` +
                `${FAILURE_COOLDOWN_MS / 1000}s.`,
            );

            return results;
          }

          /*
           * ------------------------------------------------------------------
           * CONSECUTIVE FAILURE LIMIT
           * ------------------------------------------------------------------
           */
          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            this.#activateCooldown(FAILURE_COOLDOWN_MS);

            console.error(
              `[Outreach] ${MAX_CONSECUTIVE_FAILURES} consecutive failures. ` +
                `Stopping current bulk job and cooling down for ` +
                `${FAILURE_COOLDOWN_MS / 1000}s.`,
            );

            return results;
          }

          /*
           * Do not blindly retry the same target here.
           *
           * Move to the next target after the normal six-second pacing.
           */
        } finally {
          /*
           * `sendCompleted` is deliberately not used to alter timing.
           *
           * Every attempted outbound operation has already been recorded
           * through recordOutboundCompletion() in both success and failure
           * paths.
           */
          void sendCompleted;
        }
      }

      /*
       * ----------------------------------------------------------------------
       * BATCH GAP
       * ----------------------------------------------------------------------
       *
       * After all 50 recipients in this batch have been processed, pause
       * for the full configured batch interval before starting the next batch.
       */
      const hasAnotherBatch = batchIndex < batches.length - 1;

      if (hasAnotherBatch) {
        console.log(
          `[Outreach] Batch ${batchIndex + 1}/${batches.length} complete. ` +
            `Pausing for ${BATCH_DELAY_MS / 60000} minutes before the next batch.`,
        );

        await sleep(BATCH_DELAY_MS);
      }
    }

    console.log(
      `[Outreach] Bulk job complete. ` +
        `Successful/failed results: ${results.length}.`,
    );

    return results;
  }

  /*
   * ==========================================================================
   * COOLDOWN
   * ==========================================================================
   */

  #activateCooldown(durationMs) {
    const until = now() + durationMs;

    /*
     * Keep whichever cooldown ends later.
     */
    processCooldownUntil = Math.max(processCooldownUntil, until);

    this.cooldownUntil = Math.max(this.cooldownUntil, until);
  }

  /*
   * ==========================================================================
   * CRITICAL FAILURE DETECTION
   * ==========================================================================
   */

  #isCriticalError(error) {
    const status = Number(
      error?.statusCode ?? error?.status ?? error?.output?.statusCode ?? 0,
    );

    if (status === 401 || status === 403 || status === 429) {
      return true;
    }

    const message = errorMessage(error).toLowerCase();

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
