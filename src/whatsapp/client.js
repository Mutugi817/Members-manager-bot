
import fs from 'node:fs/promises';
import path from 'node:path';
import qrcode from 'qrcode';

import makeWASocket, {
  Browsers,
  DisconnectReason,
  isJidGroup,
  isLidUser,
  isPnUser,
  jidNormalizedUser,
  useMultiFileAuthState
} from '@whiskeysockets/baileys';

import { AppError } from '../core/errors.js';
import { normalizePhone } from '../core/utils.js';
import { WhatsAppRenderer } from './renderer.js';

export class WhatsAppClient {
  constructor({
    config,
    logger
  }) {
    this.config =
      config;

    this.logger =
      logger;

    this.sock =
      null;

    this.renderer =
      null;

    this.handlers = {
      message:
        null
    };

    this.statusState = {
      status:
        'disconnected',

      qr:
        null,

      pairingCode:
        null,

      lastDisconnect:
        null,

      connectedAt:
        null
    };

    this.starting =
      null;

    this.stopped =
      false;
  }

  async start(
    onMessage
  ) {
    this.handlers.message =
      onMessage;

    this.stopped =
      false;

    if (
      this.starting
    ) {
      return this.starting;
    }

    this.starting =
      this.#startInternal()
        .finally(
          () => {
            this.starting =
              null;
          }
        );

    return this.starting;
  }

  async #startInternal() {
    await fs.mkdir(
      path.resolve(
        this.config.whatsappAuthDir
      ),
      {
        recursive:
          true
      }
    );

    const {
      state,
      saveCreds
    } =
      await useMultiFileAuthState(
        path.resolve(
          this.config.whatsappAuthDir
        )
      );

    const sock =
      makeWASocket({
        auth:
          state,

        browser:
          Browsers.ubuntu(
            this.config.appName
          ),

        printQRInTerminal:
          false,

        markOnlineOnConnect:
          false,

        syncFullHistory:
          false
      });

    this.sock =
      sock;

    this.renderer =
      new WhatsAppRenderer({
        sock,
        logger:
          this.logger
      });

    sock.ev.on(
      'creds.update',
      saveCreds
    );

    sock.ev.on(
      'connection.update',
      (update) =>
        void this.#connection(
          update
        )
    );

    sock.ev.on(
      'messages.upsert',
      (update) =>
        void this.#messages(
          update
        )
    );

    return this;
  }

  async #connection({
    connection,
    lastDisconnect,
    qr
  }) {
    if (qr) {
      this.statusState.qr =
        qr;

      this.statusState.status =
        'qr_available';
    }

    if (
      connection ===
      'connecting'
    ) {
      this.statusState.status =
        'connecting';
    }

    if (
      connection ===
      'open'
    ) {
      this.statusState = {
        ...this.statusState,

        status:
          'connected',

        qr:
          null,

        pairingCode:
          null,

        lastDisconnect:
          null,

        connectedAt:
          new Date()
            .toISOString()
      };

      this.logger.info(
        'WhatsApp connection established'
      );
    }

    if (
      connection !==
      'close'
    ) {
      return;
    }

    const code =
      lastDisconnect
        ?.error
        ?.output
        ?.statusCode ??
      null;

    this.statusState.status =
      'disconnected';

    this.statusState.lastDisconnect =
      code;

    /*
     * Baileys explicitly reports that the account/session
     * has been logged out.
     *
     * In this case the existing authentication state must
     * not be retained. Remove the entire auth directory so
     * the next connection starts as a completely fresh
     * WhatsApp authentication session.
     */
    if (
      code ===
      DisconnectReason.loggedOut
    ) {
      this.logger.warn(
        {
          code,

          authDir:
            this.config
              .whatsappAuthDir
        },
        'WhatsApp session logged out; removing authentication directory'
      );

      await this.#removeAuthDirectory();

      this.sock =
        null;

      this.renderer =
        null;

      this.statusState.qr =
        null;

      this.statusState.pairingCode =
        null;

      this.logger.info(
        'WhatsApp authentication directory removed; waiting for a new QR or pairing action.'
      );

      return;
    }

    if (
      this.stopped
    ) {
      return;
    }

    setTimeout(
      () => {
        this.start(
          this.handlers.message
        ).catch(
          (error) => {
            this.logger.error(
              {
                err:
                  error
              },
              'WhatsApp reconnect failed'
            );
          }
        );
      },
      2500
    );
  }

  async #removeAuthDirectory() {
    const authDir =
      path.resolve(
        this.config
          .whatsappAuthDir
      );

    try {
      await fs.rm(
        authDir,
        {
          recursive:
            true,

          force:
            true
        }
      );
    } catch (
      error
    ) {
      this.logger.error(
        {
          err:
            error,

          authDir
        },
        'Failed to remove WhatsApp authentication directory'
      );

      throw error;
    }
  }

  async #messages({
    messages,
    type
  }) {
    if (
      type !==
        'notify' ||
      !this.handlers.message
    ) {
      return;
    }

    for (
      const message of
      messages || []
    ) {
      try {
        await this.handlers.message(
          message
        );
      } catch (
        error
      ) {
        this.logger.error(
          {
            err:
              error
          },
          'Message handler failed; event isolated'
        );
      }
    }
  }

  isConnected() {
    return (
      this.statusState.status ===
        'connected' &&
      Boolean(
        this.sock
      )
    );
  }

  status() {
    return {
      ...this.statusState,

      qrAvailable:
        Boolean(
          this.statusState.qr
        ),

      connected:
        this.isConnected(),

      botJid:
        this.sock?.user?.id
          ? jidNormalizedUser(
              this.sock.user.id
            )
          : null
    };
  }

  async qrDataUrl() {
    if (
      !this.statusState.qr
    ) {
      return null;
    }

    return qrcode.toDataURL(
      this.statusState.qr,
      {
        width:
          360,

        margin:
          2
      }
    );
  }

  async requestPairingCode(
    phone
  ) {
    if (
      !this.sock
    ) {
      throw new AppError(
        'WhatsApp has not started yet.',
        503,
        'WHATSAPP_NOT_STARTED'
      );
    }

    if (
      this.isConnected()
    ) {
      throw new AppError(
        'WhatsApp is already connected.',
        409,
        'WHATSAPP_ALREADY_CONNECTED'
      );
    }

    const normalized =
      normalizePhone(
        phone
      );

    if (!normalized) {
      throw new AppError(
        'Enter a valid Kenyan number with country code.',
        400,
        'INVALID_PAIRING_PHONE'
      );
    }

    const code =
      await this.sock.requestPairingCode(
        normalized
      );

    this.statusState.pairingCode =
      code;

    this.statusState.status =
      'pairing_code_available';

    return code;
  }

  async resolveJid(
    jid
  ) {
    if (!jid) {
      return null;
    }

    const normalized =
      jidNormalizedUser(
        jid
      );

    if (!normalized) {
      return null;
    }

    if (
      isPnUser(
        normalized
      )
    ) {
      return normalized;
    }

    if (
      isJidGroup(
        normalized
      )
    ) {
      return normalized;
    }

    if (
      !isLidUser(
        normalized
      )
    ) {
      return normalized;
    }

    const mapping =
      this.sock
        ?.signalRepository
        ?.lidMapping;

    if (!mapping) {
      return normalized;
    }

    try {
      const pn =
        await mapping.getPNForLID(
          normalized
        );

      if (!pn) {
        return normalized;
      }

      return (
        jidNormalizedUser(
          pn
        ) ||
        pn
      );
    } catch (
      error
    ) {
      this.logger.debug(
        {
          err:
            error,

          jid:
            normalized
        },
        'Unable to resolve WhatsApp LID to PN'
      );

      return normalized;
    }
  }

  async resolveDestinationJid(
    jid
  ) {
    if (!jid) {
      return null;
    }

    const normalized =
      jidNormalizedUser(
        jid
      );

    if (!normalized) {
      return null;
    }

    if (
      isLidUser(
        normalized
      ) ||
      isJidGroup(
        normalized
      )
    ) {
      return normalized;
    }

    if (
      isPnUser(
        normalized
      )
    ) {
      const mapping =
        this.sock
          ?.signalRepository
          ?.lidMapping;

      if (mapping) {
        try {
          const lid =
            await mapping.getLIDForPN(
              normalized
            );

          if (lid) {
            return (
              jidNormalizedUser(
                lid
              ) ||
              lid
            );
          }
        } catch (
          error
        ) {
          this.logger.debug(
            {
              err:
                error,

              jid:
                normalized
            },
            'Unable to resolve PN to WhatsApp LID'
          );
        }
      }
    }

    return normalized;
  }

  async resolveUserJid(
    phone
  ) {
    const normalized =
      normalizePhone(
        phone
      );

    if (!normalized) {
      throw new AppError(
        'Invalid phone number.',
        400,
        'INVALID_PHONE'
      );
    }

    if (
      !this.sock ||
      !this.isConnected()
    ) {
      throw new AppError(
        'WhatsApp is not connected.',
        503,
        'WHATSAPP_OFFLINE'
      );
    }

    const result =
      await this.sock.onWhatsApp(
        normalized
      );

    const match =
      Array.isArray(
        result
      )
        ? result.find(
            (item) =>
              item?.exists &&
              item?.jid
          )
        : null;

    if (!match) {
      throw new AppError(
        `WhatsApp could not resolve +${normalized}.`,
        404,
        'WHATSAPP_NUMBER_NOT_FOUND'
      );
    }

    const resolved =
      await this.resolveJid(
        match.jid
      );

    if (!resolved) {
      throw new AppError(
        `WhatsApp returned an invalid identity for +${normalized}.`,
        502,
        'WHATSAPP_INVALID_RESOLVED_JID'
      );
    }

    return resolved;
  }

  async sendToPhone(
    phone,
    payload,
    options = {}
  ) {
    const jid =
      await this.resolveUserJid(
        phone
      );

    return this.sendToJid(
      jid,
      payload,
      options
    );
  }

  async sendToJid(
    jid,
    payload,
    options = {}
  ) {
    if (
      !this.isConnected()
    ) {
      throw new AppError(
        'WhatsApp is not connected.',
        503,
        'WHATSAPP_OFFLINE'
      );
    }

    const normalizedJid =
      await this.resolveDestinationJid(
        jid
      );

    if (!normalizedJid) {
      throw new AppError(
        'Invalid WhatsApp JID.',
        400,
        'INVALID_JID'
      );
    }

    const validDestination =
      isPnUser(
        normalizedJid
      ) ||
      isLidUser(
        normalizedJid
      ) ||
      isJidGroup(
        normalizedJid
      );

    if (
      !validDestination
    ) {
      this.logger.warn(
        {
          originalJid:
            jid,

          normalizedJid
        },
        'Rejected unsupported WhatsApp destination JID'
      );

      throw new AppError(
        'Invalid WhatsApp JID.',
        400,
        'INVALID_JID'
      );
    }

    const kind =
      payload?.kind ||
      (
        payload?.buttons
          ? 'interactive'
          : payload?.cards
            ? 'carousel'
            : payload?.event
              ? 'event'
              : payload?.poll
                ? 'poll'
                : payload?.image
                  ? 'image'
                  : payload?.document
                    ? 'document'
                    : 'text'
      );

    if (
      kind ===
      'interactive'
    ) {
      return this.renderer
        .sendInteractive({
          jid:
            normalizedJid,

          text:
            payload.text,

          footer:
            payload.footer,

          header:
            payload.header,

          buttons:
            payload.buttons,

          quoted:
            options.quoted
        });
    }

    if (
      kind ===
      'carousel'
    ) {
      return this.renderer
        .sendCarousel({
          jid:
            normalizedJid,

          text:
            payload.text,

          footer:
            payload.footer,

          cards:
            payload.cards,

          quoted:
            options.quoted
        });
    }

    if (
      kind ===
      'event'
    ) {
      return this.renderer
        .sendEvent(
          normalizedJid,
          payload.event,
          options
        );
    }

    if (
      kind ===
      'poll'
    ) {
      return this.renderer
        .sendPoll(
          normalizedJid,
          payload.poll,
          options
        );
    }

    if (
      kind ===
      'image'
    ) {
      return this.renderer
        .sendImage(
          normalizedJid,
          payload.image,
          payload.caption,
          options
        );
    }

    if (
      kind ===
      'document'
    ) {
      return this.renderer
        .sendDocument(
          normalizedJid,
          payload.document,
          payload.mimetype,
          payload.fileName,
          payload.caption,
          options
        );
    }

    return this.renderer
      .sendText(
        normalizedJid,
        payload.text,
        options
      );
  }

  async sendMenu(
    jid,
    menu,
    quoted
  ) {
    const normalizedJid =
      await this.resolveDestinationJid(
        jid
      );

    if (!normalizedJid) {
      throw new AppError(
        'Invalid WhatsApp JID.',
        400,
        'INVALID_JID'
      );
    }

    return this.renderer
      .sendMenu({
        jid:
          normalizedJid,

        ...menu,

        quoted
      });
  }

  async sendReference(
    jid,
    payload,
    quoted
  ) {
    const normalizedJid =
      await this.resolveDestinationJid(
        jid
      );

    if (!normalizedJid) {
      throw new AppError(
        'Invalid WhatsApp JID.',
        400,
        'INVALID_JID'
      );
    }

    return this.renderer
      .sendReference({
        jid:
          normalizedJid,

        ...payload,

        quoted
      });
  }

  async sendActions(
    jid,
    payload,
    quoted
  ) {
    const normalizedJid =
      await this.resolveDestinationJid(
        jid
      );

    if (!normalizedJid) {
      throw new AppError(
        'Invalid WhatsApp JID.',
        400,
        'INVALID_JID'
      );
    }

    return this.renderer
      .sendActionMessage({
        jid:
          normalizedJid,

        ...payload,

        quoted
      });
  }

  async groups() {
    if (
      !this.isConnected()
    ) {
      throw new AppError(
        'WhatsApp is not connected.',
        503,
        'WHATSAPP_OFFLINE'
      );
    }

    const groups =
      await this.sock
        .groupFetchAllParticipating();

    return Object.values(
      groups
    ).map(
      (group) => ({
        id:
          group.id,

        subject:
          group.subject ||
          'Unnamed group',

        owner:
          group.owner ||
          null,

        size:
          group.size ??
          group.participants
            ?.length ??
          0,

        addressingMode:
          group.addressingMode ||
          null
      })
    );
  }

  async stop() {
    this.stopped =
      true;

    const sock =
      this.sock;

    this.sock =
      null;

    this.renderer =
      null;

    if (!sock) {
      return;
    }

    try {
      sock.end(
        undefined
      );
    } catch (
      error
    ) {
      this.logger.warn(
        {
          err:
            error
        },
        'WhatsApp socket close failed'
      );
    }
  }
}
