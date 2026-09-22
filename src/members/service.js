
import { EventEmitter } from 'node:events';

import {
  jidNormalizedUser
} from '@whiskeysockets/baileys';

import { AppError } from '../core/errors.js';

import {
  cleanText,
  jidForPhone,
  nextReferenceCode,
  normalizePhone,
  phoneFromJid,
  nowIso,
  uuid
} from '../core/utils.js';

function splitName(
  fullName
) {
  const parts =
    cleanText(
      fullName
    )
      .split(/\s+/)
      .filter(
        Boolean
      );

  if (
    parts.length < 2
  ) {
    return null;
  }

  return {
    firstName:
      parts[0],

    lastName:
      parts
        .slice(1)
        .join(' '),

    fullName:
      parts.join(' ')
  };
}

function normalizeJid(
  jid
) {
  if (!jid) {
    return null;
  }

  const value =
    String(
      jid
    ).trim();

  if (!value) {
    return null;
  }

  try {
    return (
      jidNormalizedUser(
        value
      ) ||
      value
    );
  } catch {
    return value;
  }
}

export class MemberService
  extends EventEmitter
{
  constructor({
    store,
    config
  }) {
    super();

    this.store =
      store;

    this.config =
      config;
  }

  list({
    status = 'all',
    q = ''
  } = {}) {
    let members =
      this.store
        .get()
        .members || [];

    if (
      status !==
      'all'
    ) {
      members =
        members.filter(
          (member) =>
            member.status ===
            status
        );
    }

    const query =
      cleanText(
        q
      ).toLowerCase();

    if (query) {
      members =
        members.filter(
          (member) =>
            [
              member.code,
              member.fullName,
              member.phone,
              member.whatsappJid
            ].some(
              (value) =>
                String(
                  value || ''
                )
                  .toLowerCase()
                  .includes(
                    query
                  )
            )
        );
    }

    return members;
  }

  getById(
    id
  ) {
    if (
      id ===
        undefined ||
      id === null ||
      String(
        id
      ).trim() === ''
    ) {
      return null;
    }

    return (
      this.list({
        status:
          'active'
      }).find(
        (member) =>
          member.id ===
          id
      ) ||
      null
    );
  }

  getByCode(
    code
  ) {
    if (
      code ===
        undefined ||
      code === null
    ) {
      return null;
    }

    const normalizedCode =
      String(
        code
      )
        .trim()
        .toLowerCase();

    if (!normalizedCode) {
      return null;
    }

    return (
      this.list({
        status:
          'active'
      }).find(
        (member) =>
          String(
            member.code ||
              ''
          )
            .trim()
            .toLowerCase() ===
          normalizedCode
      ) ||
      null
    );
  }

  getByJid(
    jid
  ) {
    if (!jid) {
      return null;
    }

    const normalizedJid =
      normalizeJid(
        jid
      );

    if (!normalizedJid) {
      return null;
    }

    const active =
      this.list({
        status:
          'active'
      });

    const exact =
      active.find(
        (member) => {
          if (
            !member.whatsappJid
          ) {
            return false;
          }

          const memberJid =
            normalizeJid(
              member.whatsappJid
            );

          return (
            memberJid ===
            normalizedJid
          );
        }
      );

    if (exact) {
      return exact;
    }

    const normalizedPhone =
      phoneFromJid(
        normalizedJid
      );

    if (
      !normalizedPhone
    ) {
      return null;
    }

    return (
      active.find(
        (member) =>
          normalizePhone(
            member.phone
          ) ===
          normalizedPhone
      ) ||
      null
    );
  }

  getByPhone(
    phone
  ) {
    const normalized =
      normalizePhone(
        phone
      );

    if (!normalized) {
      return null;
    }

    return (
      this.list({
        status:
          'active'
      }).find(
        (member) =>
          normalizePhone(
            member.phone
          ) ===
          normalized
      ) ||
      null
    );
  }

  validate({
    fullName,
    phone
  }) {
    const names =
      splitName(
        fullName
      );

    const normalized =
      normalizePhone(
        phone
      );

    return {
      fullName:
        names?.fullName ||
        cleanText(
          fullName
        ),

      firstName:
        names?.firstName ||
        '',

      lastName:
        names?.lastName ||
        '',

      phone:
        normalized,

      isValid:
        Boolean(
          names &&
          normalized
        )
    };
  }

  async register({
    fullName,
    phone,
    whatsappJid
  }) {
    const checked =
      this.validate({
        fullName,
        phone
      });

    if (
      !checked.fullName ||
      !checked.lastName
    ) {
      throw new AppError(
        'Please provide your first and second name.',
        400,
        'INVALID_NAME'
      );
    }

    if (!checked.phone) {
      throw new AppError(
        'Please provide a valid phone number.',
        400,
        'INVALID_PHONE'
      );
    }

    const normalizedWhatsappJid =
      whatsappJid
        ? normalizeJid(
            whatsappJid
          )
        : jidForPhone(
            checked.phone
          );

    const member =
      await this.store.mutate(
        (db) => {
          const members =
            Array.isArray(
              db.members
            )
              ? db.members
              : [];

          for (
            const member of members
          ) {
            if (
              member &&
              !member.id
            ) {
              member.id =
                uuid();
            }
          }

          const active =
            members.filter(
              (member) =>
                member &&
                member.status ===
                  'active'
            );

          const byPhone =
            active.find(
              (member) =>
                normalizePhone(
                  member.phone
                ) ===
                checked.phone
            );

          if (byPhone) {
            throw new AppError(
              `This phone number is already registered under ${byPhone.code}.`,
              409,
              'DUPLICATE_PHONE'
            );
          }

          const byJid =
            normalizedWhatsappJid
              ? active.find(
                  (member) => {
                    if (
                      !member.whatsappJid
                    ) {
                      return false;
                    }

                    const memberJid =
                      normalizeJid(
                        member.whatsappJid
                      );

                    return (
                      memberJid ===
                      normalizedWhatsappJid
                    );
                  }
                )
              : null;

          if (byJid) {
            throw new AppError(
              `This WhatsApp account is already registered as ${byJid.code}.`,
              409,
              'DUPLICATE_WHATSAPP'
            );
          }

          const code =
            nextReferenceCode(
              this.config
                .referenceCodePrefix,

              this.config
                .referenceCodeStart,

              this.config
                .referenceCodePad,

              members.map(
                (member) =>
                  member.code
              )
            );

          const now =
            nowIso();

          const member = {
            id:
              uuid(),

            code,

            fullName:
              checked.fullName,

            firstName:
              checked.firstName,

            lastName:
              checked.lastName,

            phone:
              checked.phone,

            rawPhone:
              phone,

            whatsappJid:
              normalizedWhatsappJid,

            status:
              'active',

            remindersEnabled:
              true,

            createdAt:
              now,

            updatedAt:
              now,

            validation: {
              isValid:
                true,

              issues: []
            }
          };

          members.push(
            member
          );

          db.updatedAt =
            now;

          db.members =
            members;

          return member;
        }
      );

    this.emit(
      'member:registered',
      member
    );

    return member;
  }

  async update(
    id,
    patch = {}
  ) {
    const member =
      await this.store.mutate(
        (db) => {
          const members =
            Array.isArray(
              db.members
            )
              ? db.members
              : [];

          for (
            const member of members
          ) {
            if (
              member &&
              !member.id
            ) {
              member.id =
                uuid();
            }
          }

          const member =
            members.find(
              (item) =>
                item &&
                item.id === id &&
                item.status ===
                  'active'
            );

          if (!member) {
            throw new AppError(
              'Member not found.',
              404,
              'MEMBER_NOT_FOUND'
            );
          }

          const fullName =
            patch.fullName !==
            undefined
              ? patch.fullName
              : member.fullName;

          const phone =
            patch.phone !==
            undefined
              ? patch.phone
              : member.phone;

          const checked =
            this.validate({
              fullName,
              phone
            });

          if (
            !checked.fullName ||
            !checked.lastName
          ) {
            throw new AppError(
              'Please provide your first and second name.',
              400,
              'INVALID_NAME'
            );
          }

          if (!checked.phone) {
            throw new AppError(
              'Please provide a valid phone number.',
              400,
              'INVALID_PHONE'
            );
          }

          const activeOther =
            members.filter(
              (item) =>
                item &&
                item.id !== id &&
                item.status ===
                  'active'
            );

          const duplicatePhone =
            activeOther.find(
              (item) =>
                normalizePhone(
                  item.phone
                ) ===
                checked.phone
            );

          if (
            duplicatePhone
          ) {
            throw new AppError(
              `That phone number is already linked to ${duplicatePhone.code}.`,
              409,
              'DUPLICATE_PHONE'
            );
          }

          let normalizedWhatsappJid =
            member.whatsappJid
              ? normalizeJid(
                  member.whatsappJid
                )
              : null;

          if (
            patch.whatsappJid
          ) {
            normalizedWhatsappJid =
              normalizeJid(
                patch.whatsappJid
              );
          }

          if (
            !normalizedWhatsappJid
          ) {
            normalizedWhatsappJid =
              jidForPhone(
                checked.phone
              );
          }

          const duplicateJid =
            activeOther.find(
              (item) => {
                if (
                  !item.whatsappJid ||
                  !normalizedWhatsappJid
                ) {
                  return false;
                }

                const memberJid =
                  normalizeJid(
                    item.whatsappJid
                  );

                return (
                  memberJid ===
                  normalizedWhatsappJid
                );
              }
            );

          if (
            duplicateJid
          ) {
            throw new AppError(
              `That WhatsApp account is already linked to ${duplicateJid.code}.`,
              409,
              'DUPLICATE_WHATSAPP'
            );
          }

          member.fullName =
            checked.fullName;

          member.firstName =
            checked.firstName;

          member.lastName =
            checked.lastName;

          member.phone =
            checked.phone;

          member.rawPhone =
            patch.phone !==
            undefined
              ? patch.phone
              : member.rawPhone;

          member.whatsappJid =
            normalizedWhatsappJid;

          member.updatedAt =
            nowIso();

          member.validation = {
            isValid:
              true,

            issues: []
          };

          db.updatedAt =
            member.updatedAt;

          db.members =
            members;

          return member;
        }
      );

    this.emit(
      'member:updated',
      member
    );

    return member;
  }

  async deleteSelf(
    id
  ) {
    const deleted =
      await this.store.mutate(
        (db) => {
          const members =
            Array.isArray(
              db.members
            )
              ? db.members
              : [];

          const index =
            members.findIndex(
              (member) =>
                member &&
                member.id ===
                  id
            );

          if (
            index < 0
          ) {
            throw new AppError(
              'Member not found.',
              404,
              'MEMBER_NOT_FOUND'
            );
          }

          const member =
            members[index];

          members.splice(
            index,
            1
          );

          const now =
            nowIso();

          db.updatedAt =
            now;

          db.members =
            members;

          return {
            ...member,

            status:
              'deleted',

            deletedAt:
              now,

            updatedAt:
              now,

            whatsappJid:
              null
          };
        }
      );

    this.emit(
      'member:deleted',
      deleted
    );

    return deleted;
  }

  async setReminders(
    id,
    enabled
  ) {
    return this.store.mutate(
      (db) => {
        const members =
          Array.isArray(
            db.members
          )
            ? db.members
            : [];

        const member =
          members.find(
            (item) =>
              item &&
              item.id === id &&
              item.status ===
                'active'
          );

        if (!member) {
          throw new AppError(
            'Member not found.',
            404,
            'MEMBER_NOT_FOUND'
          );
        }

        member.remindersEnabled =
          Boolean(
            enabled
          );

        member.updatedAt =
          nowIso();

        db.updatedAt =
          member.updatedAt;

        db.members =
          members;

        return member;
      }
    );
  }

  stats() {
    const members =
      this.list({
        status:
          'active'
      });

    const valid =
      members.filter(
        (member) =>
          member.validation?.isValid &&
          member.phone &&
          member.lastName
      );

    const phones =
      new Map();

    for (
      const member of members
    ) {
      const phone =
        normalizePhone(
          member.phone
        );

      if (!phone) {
        continue;
      }

      phones.set(
        phone,
        (
          phones.get(
            phone
          ) || 0
        ) + 1
      );
    }

    return {
      total:
        members.length,

      valid:
        valid.length,

      invalid:
        members.length -
        valid.length,

      linked:
        members.filter(
          (member) =>
            Boolean(
              member.whatsappJid
            )
        ).length,

      remindersEnabled:
        members.filter(
          (member) =>
            member.remindersEnabled
        ).length,

      duplicatePhones:
        [
          ...phones.values()
        ].filter(
          (count) =>
            count > 1
        ).length
    };
  }

  notificationTargets(
    mode,
    memberIds = []
  ) {
    const active =
      this.list({
        status:
          'active'
      });

    if (
      mode ===
      'selected'
    ) {
      return active.filter(
        (member) =>
          memberIds.includes(
            member.id
          )
      );
    }

    return active;
  }

  invalidTargets() {
    return this.list({
      status:
        'active'
    }).filter(
      (member) =>
        member.phone &&
        member.whatsappJid &&
        (
          !member.lastName ||
          !member.validation?.isValid
        )
    );
  }
}
