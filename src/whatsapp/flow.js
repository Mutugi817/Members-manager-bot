import {
  jidNormalizedUser
} from '@whiskeysockets/baileys';

import {
  cleanText,
  jidForPhone,
  normalizePhone,
  phoneFromJid
} from '../core/utils.js';

export class MemberFlow {
  constructor({
    members,
    whatsapp,
    config
  }) {
    this.members = members;
    this.whatsapp = whatsapp;
    this.config = config;
    this.states = new Map();
  }

  #stateJid(jid) {
    return (
      jidNormalizedUser(jid) ||
      String(jid || '').trim()
    );
  }

  start(jid, mode) {
    const key =
      this.#stateJid(jid);

    const current =
      this.members.getByJid(
        key
      );

    const effectiveMode =
      current
        ? 'update'
        : mode;

    this.states.set(
      key,
      {
        mode: effectiveMode,

        step:
          current
            ? 'name_choice'
            : 'name',

        expiresAt:
          Date.now() +
          10 * 60_000,

        currentId:
          current?.id ||
          null,

        currentPhone:
          current?.phone ||
          null
      }
    );

    if (current) {
      return {
        kind: 'interactive',

        text:
          `Welcome, ${current.firstName}.\n\n` +
          `Your current name is ${current.fullName}.\n\n` +
          `Would you like to keep this name or change it?`,

        footer:
          this.config.botFooter,

        buttons: [
          this.whatsapp.renderer.quickReply(
            'Keep my name',
            'registration:keep-name'
          ),

          this.whatsapp.renderer.quickReply(
            'Change my name',
            'registration:change-name'
          ),

          this.whatsapp.renderer.quickReply(
            'Cancel',
            'registration:cancel'
          )
        ]
      };
    }

    return {
      kind: 'interactive',

      text:
        `Welcome.\n\n` +
        `Let us register your membership.\n\n` +
        `Please enter your first and second name.`,

      footer:
        this.config.botFooter,

      buttons: [
        this.whatsapp.renderer.quickReply(
          'Cancel',
          'registration:cancel'
        )
      ]
    };
  }

  cancel(jid) {
    this.states.delete(
      this.#stateJid(jid)
    );
  }

  #expired(jid) {
    const key =
      this.#stateJid(jid);

    const state =
      this.states.get(key);

    if (!state) {
      return null;
    }

    if (
      Date.now() >
      state.expiresAt
    ) {
      this.states.delete(key);

      return {
        kind: 'text',
        text:
          `This registration session has expired.\n\n` +
          `Please send ${this.config.botKeyword} again.`
      };
    }

    return state;
  }

  async text(jid, text) {
    const key =
      this.#stateJid(jid);

    const state =
      this.#expired(key);

    if (!state) {
      return null;
    }

    const input =
      cleanText(text);

    if (
      input.toLowerCase() ===
      'cancel'
    ) {
      this.cancel(key);

      return {
        kind: 'text',
        text:
          'Your registration session has been cancelled. No changes were made.'
      };
    }

    if (
      state.step === 'name'
    ) {
      const names =
        input
          .split(/\s+/)
          .filter(Boolean);

      if (names.length < 2) {
        return {
          kind: 'text',
          text:
            'Please enter both your first and second name.'
        };
      }

      state.fullName =
        names.join(' ');

      state.firstName =
        names[0];

      state.lastName =
        names
          .slice(1)
          .join(' ');

      state.step =
        'phone_choice';

      state.expiresAt =
        Date.now() +
        10 * 60_000;

      return this.#phoneChoice(
        key,
        state
      );
    }

    if (
      state.step === 'phone'
    ) {
      const phone =
        normalizePhone(input);

      if (!phone) {
        return {
          kind: 'text',
          text:
            'Please enter a valid phone number.'
        };
      }

      state.phone =
        phone;

      return this.#confirm(
        key,
        state
      );
    }

    if (
      state.step === 'confirm'
    ) {
      return {
        kind: 'text',
        text:
          'Please use the Confirm, Edit or Cancel button above to finish your registration.'
      };
    }

    return null;
  }

  async action(jid, id) {
    const key =
      this.#stateJid(jid);

    const state =
      this.#expired(key);

    if (!state) {
      return null;
    }

    if (
      id ===
      'registration:cancel'
    ) {
      this.cancel(key);

      return {
        kind: 'text',
        text:
          'Your registration session has been cancelled. No changes were made.'
      };
    }

    if (
      state.step ===
      'name_choice'
    ) {
      const current =
        this.members.getByJid(
          key
        );

      if (
        id ===
          'registration:keep-name' &&
        current
      ) {
        state.fullName =
          current.fullName;

        state.firstName =
          current.firstName;

        state.lastName =
          current.lastName;

        state.phone =
          current.phone;

        state.detectedPhone =
          current.phone;

        state.step =
          'phone_choice';

        state.expiresAt =
          Date.now() +
          10 * 60_000;

        return this.#phoneChoice(
          key,
          state
        );
      }

      if (
        id ===
        'registration:change-name'
      ) {
        state.step =
          'name';

        state.expiresAt =
          Date.now() +
          10 * 60_000;

        return {
          kind: 'text',
          text:
            'Please enter your first and second name.'
        };
      }
    }

    if (
      state.step ===
      'phone_choice'
    ) {
      if (
        id ===
        'registration:use-number'
      ) {
        if (!state.detectedPhone) {
          state.step =
            'phone';

          return {
            kind: 'text',
            text:
              'I could not safely detect your WhatsApp number. Please enter the number you want to use.'
          };
        }

        state.phone =
          normalizePhone(
            state.detectedPhone
          );

        return this.#confirm(
          key,
          state
        );
      }

      if (
        id ===
        'registration:change-number'
      ) {
        state.step =
          'phone';

        state.expiresAt =
          Date.now() +
          10 * 60_000;

        return {
          kind: 'text',
          text:
            'Please enter the phone number you want to use for your membership.'
        };
      }
    }

    if (
      state.step ===
      'confirm'
    ) {
      if (
        id ===
        'registration:confirm'
      ) {
        return this.#finish(
          key,
          state
        );
      }

      if (
        id ===
        'registration:edit'
      ) {
        state.step =
          'name_choice';

        state.expiresAt =
          Date.now() +
          10 * 60_000;

        return this.start(
          key,
          state.mode
        );
      }
    }

    return null;
  }

  #phoneChoice(jid, state) {
    const current =
      this.members.getByJid(
        jid
      );

    state.detectedPhone =
      current?.phone ||
      phoneFromJid(jid);

    if (!state.detectedPhone) {
      state.step =
        'phone';

      return {
        kind: 'text',
        text:
          `Thank you, ${state.firstName}.\n\n` +
          `Please enter the phone number for this membership.`
      };
    }

    return {
      kind: 'interactive',

      text:
        `Thank you, ${state.firstName}.\n\n` +
        `I detected your WhatsApp number as +${state.detectedPhone}.\n\n` +
        `Would you like to use this number for your membership?`,

      footer:
        this.config.botFooter,

      buttons: [
        this.whatsapp.renderer.quickReply(
          'Use this number',
          'registration:use-number'
        ),

        this.whatsapp.renderer.quickReply(
          'Change number',
          'registration:change-number'
        ),

        this.whatsapp.renderer.quickReply(
          'Cancel',
          'registration:cancel'
        )
      ]
    };
  }

  #confirm(jid, state) {
    state.step =
      'confirm';

    state.expiresAt =
      Date.now() +
      10 * 60_000;

    return {
      kind: 'interactive',

      text:
        `Please confirm your details.\n\n` +
        `Name: ${state.fullName}\n` +
        `WhatsApp: +${state.phone}\n\n` +
        `Everything looks ready.`,

      footer:
        this.config.botFooter,

      buttons: [
        this.whatsapp.renderer.quickReply(
          'Confirm',
          'registration:confirm'
        ),

        this.whatsapp.renderer.quickReply(
          'Edit',
          'registration:edit'
        ),

        this.whatsapp.renderer.quickReply(
          'Cancel',
          'registration:cancel'
        )
      ]
    };
  }

  async #finish(jid, state) {
    /*
     * The phone selected/confirmed during registration is
     * the durable member identity.
     *
     * This deliberately avoids storing a transient @lid.
     */
    const phone =
      normalizePhone(
        state.phone
      );

    if (!phone) {
      return {
        kind: 'text',
        text:
          'I could not validate the phone number for this membership. Please restart the registration.'
      };
    }

    const whatsappJid =
      jidForPhone(phone);

    let member;

    if (
      state.mode === 'update' &&
      state.currentId
    ) {
      member =
        await this.members.update(
          state.currentId,
          {
            fullName:
              state.fullName,

            phone,

            whatsappJid
          }
        );
    } else {
      member =
        await this.members.register({
          fullName:
            state.fullName,

          phone,

          whatsappJid
        });
    }

    this.cancel(jid);

    return {
      kind: 'reference',

      member,

      intro:
        `✅ Membership ${
          state.mode === 'update'
            ? 'updated'
            : 'registered'
        } successfully.\n\n` +

        `Thank you, ${member.firstName}.\n\n` +

        `Your reference is ${member.code}.\n\n` +

        `Your details are now saved. ` +
        `You can send ${this.config.botKeyword} whenever you need the member menu.`,

      footer:
        this.config.botFooter
    };
  }
}