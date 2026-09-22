import path from 'node:path';
import fs from 'node:fs/promises';

import {
  jidNormalizedUser
} from '@whiskeysockets/baileys';

import {
  JsonStore
} from './json-store.js';

import {
  jidForPhone,
  normalizePhone,
  nowIso,
  uuid
} from '../core/utils.js';

export class Database {
  constructor({
    config,
    logger
  }) {
    this.config = config;
    this.logger = logger;

    this.members =
      new JsonStore(
        config.membersFile,
        {
          version: 1,
          updatedAt:
            nowIso(),
          members: []
        },
        logger
      );

    this.settings =
      new JsonStore(
        config.settingsFile,
        {
          version: 1,
          updatedAt:
            nowIso(),
          settings: {}
        },
        logger
      );

    this.reminders =
      new JsonStore(
        config.remindersFile,
        {
          version: 1,
          updatedAt:
            nowIso(),
          reminders: []
        },
        logger
      );
  }

  async init() {
    await fs.mkdir(
      this.config.dataDir,
      {
        recursive: true
      }
    );

    await fs.mkdir(
      this.config.uploadDir,
      {
        recursive: true
      }
    );

    await this.members.init();
    await this.settings.init();
    await this.reminders.init();

    await this.#seedIfNeeded();
    await this.#repairMembers();

    return this;
  }

  async #seedIfNeeded() {
    const current =
      this.members
        .get()
        .members || [];

    if (
      current.length ||
      !this.config.autoSeed
    ) {
      return;
    }

    const raw =
      JSON.parse(
        await fs.readFile(
          path.resolve(
            this.config.seedFile
          ),
          'utf8'
        )
      );

    const members =
      Array.isArray(
        raw.members
      )
        ? raw.members
        : [];

    await this.members.replace({
      version: 1,

      updatedAt:
        nowIso(),

      members
    });

    this.logger.info(
      {
        count:
          members.length
      },
      'Member seed loaded'
    );
  }

  async #repairMembers() {
    const current =
      this.members
        .get()
        .members || [];

    if (!current.length) {
      return;
    }

    let changed =
      false;

    const ids =
      new Set();

    for (
      const member of current
    ) {
      if (
        !member.id ||
        ids.has(
          member.id
        )
      ) {
        member.id =
          uuid();

        changed =
          true;
      }

      ids.add(
        member.id
      );

      const normalizedPhone =
        normalizePhone(
          member.phone
        );

      if (
        normalizedPhone &&
        normalizedPhone !==
          member.phone
      ) {
        member.phone =
          normalizedPhone;

        changed =
          true;
      }

      if (
        member.phone &&
        !member.whatsappJid
      ) {
        member.whatsappJid =
          jidForPhone(
            member.phone
          );

        changed =
          true;
      }

      if (
        member.whatsappJid
      ) {
        const normalizedJid =
          jidNormalizedUser(
            member.whatsappJid
          );

        if (
          normalizedJid &&
          normalizedJid !==
            member.whatsappJid
        ) {
          member.whatsappJid =
            normalizedJid;

          changed =
            true;
        }
      }

      if (
        !member.status
      ) {
        member.status =
          'active';

        changed =
          true;
      }

      if (
        member.remindersEnabled ===
        undefined
      ) {
        member.remindersEnabled =
          true;

        changed =
          true;
      }

      if (
        !member.validation
      ) {
        member.validation = {
          isValid:
            Boolean(
              member.fullName &&
              member.lastName &&
              member.phone
            ),

          issues: []
        };

        changed =
          true;
      }
    }

    if (!changed) {
      return;
    }

    const updatedAt =
      nowIso();

    await this.members.replace({
      version: 1,

      updatedAt,

      members: current
    });

    this.logger.info(
      {
        count:
          current.length
      },
      'Member records repaired'
    );
  }
}