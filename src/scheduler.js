import cron from 'node-cron';

import {
  nowIso,
  uuid
} from './core/utils.js';

export class SchedulerService {
  constructor({
    store,
    config,
    outreach,
    whatsapp,
    logger = null
  }) {
    this.store =
      store;

    this.config =
      config;

    this.outreach =
      outreach;

    this.whatsapp =
      whatsapp;

    this.logger =
      logger;

    this.jobs =
      new Map();
  }

  async init() {
    const database =
      this.store.get() || {};

    const reminders =
      Array.isArray(
        database.reminders
      )
        ? database.reminders
        : [];

    /*
     * Scheduled sending remains completely disabled unless
     * ENABLE_SCHEDULED_MESSAGES=true.
     */
    if (
      !this.config
        .enableScheduledMessages
    ) {
      return;
    }

    for (
      const reminder of reminders
    ) {
      if (
        reminder?.active
      ) {
        this.#schedule(
          reminder
        );
      }
    }
  }

  list() {
    const database =
      this.store.get() || {};

    return Array.isArray(
      database.reminders
    )
      ? database.reminders
      : [];
  }

  async create(
    input = {}
  ) {
    const scheduleType =
      input.scheduleType ===
      'cron'
        ? 'cron'
        : 'once';

    const title =
      String(
        input.title ||
          'Reminder'
      ).trim();

    const cronExpression =
      input.cronExpression
        ? String(
            input.cronExpression
          ).trim()
        : null;

    const runAt =
      input.runAt
        ? String(
            input.runAt
          ).trim()
        : null;

    const payload =
      input.payload &&
      typeof input.payload ===
        'object'
        ? input.payload
        : {
            kind:
              'text',

            text:
              String(
                input.text ||
                  ''
              )
          };

    const reminder = {
      id:
        uuid(),

      title:
        title ||
        'Reminder',

      scheduleType,

      runAt,

      cronExpression,

      targetType:
        input.targetType ||
        'all_members',

      targetIds:
        Array.isArray(
          input.targetIds
        )
          ? input.targetIds
          : [],

      payload,

      active:
        true,

      createdAt:
        nowIso()
    };

    this.#validateReminder(
      reminder
    );

    const saved =
      await this.store.mutate(
        (db) => {
          if (
            !Array.isArray(
              db.reminders
            )
          ) {
            db.reminders =
              [];
          }

          db.reminders.push(
            reminder
          );

          db.updatedAt =
            nowIso();

          return reminder;
        }
      );

    /*
     * Do not create active runtime jobs while the feature
     * is disabled.
     */
    if (
      this.config
        .enableScheduledMessages
    ) {
      this.#schedule(
        saved
      );
    }

    return saved;
  }

  async stop(
    id
  ) {
    const job =
      this.jobs.get(
        id
      );

    if (job) {
      job.stop();
      this.jobs.delete(
        id
      );
    }

    return this.store.mutate(
      (db) => {
        if (
          !Array.isArray(
            db.reminders
          )
        ) {
          db.reminders =
            [];
        }

        const reminder =
          db.reminders.find(
            (item) =>
              item.id ===
              id
          );

        if (!reminder) {
          return null;
        }

        reminder.active =
          false;

        reminder.stoppedAt =
          nowIso();

        db.updatedAt =
          reminder.stoppedAt;

        return reminder;
      }
    );
  }

  #validateReminder(
    reminder
  ) {
    if (
      typeof reminder.title !==
        'string' ||
      !reminder.title.trim()
    ) {
      throw new Error(
        'A reminder title is required.'
      );
    }

    if (
      !reminder.payload ||
      typeof reminder.payload !==
        'object'
    ) {
      throw new Error(
        'A valid message payload is required.'
      );
    }

    const kind =
      String(
        reminder.payload.kind ||
          'text'
      ).trim();

    const hasText =
      typeof reminder
        .payload.text ===
        'string' &&
      reminder.payload.text.trim()
        .length > 0;

    const isStructuredPayload =
      kind ===
        'carousel' ||
      kind ===
        'interactive';

    if (
      !hasText &&
      !isStructuredPayload
    ) {
      throw new Error(
        'A message is required.'
      );
    }

    if (
      reminder.scheduleType ===
      'cron'
    ) {
      if (
        !reminder.cronExpression ||
        !cron.validate(
          reminder.cronExpression
        )
      ) {
        throw new Error(
          'Invalid cron expression.'
        );
      }
    }

    if (
      reminder.scheduleType ===
      'once'
    ) {
      if (
        !reminder.runAt
      ) {
        throw new Error(
          'A future run time is required.'
        );
      }

      const time =
        new Date(
          reminder.runAt
        ).getTime();

      if (
        !Number.isFinite(
          time
        ) ||
        time <= Date.now()
      ) {
        throw new Error(
          'Choose a future run time.'
        );
      }
    }

    if (
      !reminder.targetType
    ) {
      throw new Error(
        'A target type is required.'
      );
    }

    if (
      !Array.isArray(
        reminder.targetIds
      )
    ) {
      throw new Error(
        'Target IDs must be an array.'
      );
    }
  }

  #schedule(
    reminder
  ) {
    /*
     * Prevent duplicate runtime jobs if init() or create()
     * encounters the same reminder more than once.
     */
    const existing =
      this.jobs.get(
        reminder.id
      );

    if (existing) {
      existing.stop();
      this.jobs.delete(
        reminder.id
      );
    }

    if (
      reminder.scheduleType ===
      'cron'
    ) {
      const job =
        cron.schedule(
          reminder.cronExpression,
          () => {
            void this
              .#execute(
                reminder
              )
              .catch(
                (error) => {
                  this.#logExecutionError(
                    reminder,
                    error
                  );
                }
              );
          },
          {
            noOverlap:
              true
          }
        );

      this.jobs.set(
        reminder.id,
        job
      );

      return;
    }

    let stopped =
      false;

    let timer =
      null;

    const tick =
      () => {
        if (
          stopped
        ) {
          return;
        }

        const runAt =
          new Date(
            reminder.runAt
          ).getTime();

        const remaining =
          runAt -
          Date.now();

        if (
          !Number.isFinite(
            runAt
          )
        ) {
          this.#log(
            'error',
            {
              reminderId:
                reminder.id
            },
            'Invalid once reminder run time'
          );

          return;
        }

        if (
          remaining <=
          0
        ) {
          void this
            .#execute(
              reminder
            )
            .catch(
              (error) => {
                this.#logExecutionError(
                  reminder,
                  error
                );
              }
            );

          return;
        }

        timer =
          setTimeout(
            tick,
            Math.min(
              remaining,
              2 ** 31 - 1
            )
          );
      };

    tick();

    this.jobs.set(
      reminder.id,
      {
        stop: () => {
          stopped =
            true;

          if (
            timer
          ) {
            clearTimeout(
              timer
            );

            timer =
              null;
          }
        }
      }
    );
  }

  async #execute(
    reminder
  ) {
    if (
      !this.config
        .enableScheduledMessages
    ) {
      return;
    }

    if (
      !reminder?.active
    ) {
      return;
    }

    if (
      !this.whatsapp
        .isConnected()
    ) {
      this.#log(
        'warn',
        {
          reminderId:
            reminder.id
        },
        'Scheduled reminder skipped because WhatsApp is offline'
      );

      return;
    }

    await this.outreach
      .sendCampaign({
        targetType:
          reminder.targetType,

        targetIds:
          reminder.targetIds,

        payload:
          reminder.payload
      });

    if (
      reminder.scheduleType ===
      'once'
    ) {
      await this.stop(
        reminder.id
      );
    }
  }

  #logExecutionError(
    reminder,
    error
  ) {
    this.#log(
      'error',
      {
        err:
          error,

        reminderId:
          reminder?.id ??
          null,

        title:
          reminder?.title ??
          null
      },
      'Scheduled reminder execution failed'
    );
  }

  #log(
    level,
    data,
    message
  ) {
    if (
      !this.logger
    ) {
      return;
    }

    const method =
      this.logger[level];

    if (
      typeof method ===
      'function'
    ) {
      method.call(
        this.logger,
        data,
        message
      );
    }
  }

  stopAll() {
    for (
      const job of
      this.jobs.values()
    ) {
      try {
        job.stop();
      } catch {
        /*
         * Shutdown should continue even if one runtime
         * job reports an error while stopping.
         */
      }
    }

    this.jobs.clear();
  }
}
