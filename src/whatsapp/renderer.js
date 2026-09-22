
import {
  generateWAMessageFromContent,
  prepareWAMessageMedia,
  proto
} from '@whiskeysockets/baileys';

import { AppError } from '../core/errors.js';

const MIXED_NATIVE_NODE =
  Object.freeze({
    tag: 'biz',
    attrs: {},
    content: [
      {
        tag: 'interactive',
        attrs: {
          type: 'native_flow',
          v: '1'
        },
        content: [
          {
            tag: 'native_flow',
            attrs: {
              v: '9',
              name: 'mixed'
            }
          }
        ]
      }
    ]
  });

function cloneNode(node) {
  return structuredClone(node);
}

export class WhatsAppRenderer {
  constructor({
    sock,
    logger
  }) {
    this.sock = sock;
    this.logger = logger;
  }

  quickReply(text, id) {
    return {
      name: 'quick_reply',

      buttonParamsJson:
        JSON.stringify({
          display_text: text,
          id
        })
    };
  }

  copyButton(
    text,
    id,
    code
  ) {
    return {
      name: 'cta_copy',

      buttonParamsJson:
        JSON.stringify({
          display_text: text,
          id,
          copy_code: code
        })
    };
  }

  selectButton(
    title,
    sections
  ) {
    return {
      name: 'single_select',

      buttonParamsJson:
        JSON.stringify({
          title,
          sections
        })
    };
  }

  urlButton(
    text,
    url
  ) {
    return {
      name: 'cta_url',

      buttonParamsJson:
        JSON.stringify({
          display_text: text,
          url,
          merchant_url: url
        })
    };
  }

  callButton(
    text,
    phone
  ) {
    return {
      name: 'cta_call',

      buttonParamsJson:
        JSON.stringify({
          display_text: text,
          phone_number: phone
        })
    };
  }

  validateButton(button) {
    if (
      !button ||
      typeof button.name !==
        'string' ||
      typeof button.buttonParamsJson !==
        'string'
    ) {
      throw new AppError(
        'Invalid interactive button.',
        400,
        'INVALID_INTERACTIVE_BUTTON'
      );
    }

    try {
      JSON.parse(
        button.buttonParamsJson
      );
    } catch {
      throw new AppError(
        `Invalid JSON in ${button.name} button parameters.`,
        400,
        'INVALID_BUTTON_JSON'
      );
    }

    return proto.Message
      .InteractiveMessage
      .NativeFlowMessage
      .NativeFlowButton
      .fromObject(
        button
      );
  }

  validateInteractive(
    buttons
  ) {
    if (
      !Array.isArray(buttons) ||
      !buttons.length
    ) {
      throw new AppError(
        'At least one interactive control is required.',
        400,
        'INTERACTIVE_REQUIRED'
      );
    }

    if (
      buttons.length > 4
    ) {
      throw new AppError(
        'WhatsApp native-flow messages are limited to four controls in this application.',
        400,
        'TOO_MANY_INTERACTIVE_CONTROLS'
      );
    }

    return buttons.map(
      (button) =>
        this.validateButton(
          button
        )
    );
  }

  #relayNodes(jid) {
    const nodes = [
      cloneNode(
        MIXED_NATIVE_NODE
      )
    ];

    if (
      !String(jid).endsWith(
        '@g.us'
      )
    ) {
      nodes.unshift({
        tag: 'bot',
        attrs: {
          biz_bot: '1'
        }
      });
    }

    return nodes;
  }

  async #relay(
    jid,
    message,
    quoted
  ) {
    const generated =
      generateWAMessageFromContent(
        jid,
        message,
        {
          quoted,

          userJid:
            this.sock.user?.id
        }
      );

    if (
      !generated?.message ||
      !generated?.key?.id
    ) {
      throw new Error(
        'Baileys could not construct the message.'
      );
    }

    const result =
      await this.sock.relayMessage(
        jid,
        generated.message,
        {
          messageId:
            generated.key.id,

          additionalNodes:
            this.#relayNodes(
              jid
            )
        }
      );

    return {
      result,

      messageId:
        generated.key.id
    };
  }

  async sendInteractive({
    jid,
    text,
    footer,
    header,
    buttons,
    quoted
  }) {
    const nativeButtons =
      this.validateInteractive(
        buttons
      );

    const interactive =
      proto.Message
        .InteractiveMessage
        .fromObject({
          ...(header
            ? {
                header:
                  proto.Message
                    .InteractiveMessage
                    .Header.fromObject(
                      header
                    )
              }
            : {
                header: {
                  hasMediaAttachment:
                    false
                }
              }),

          body:
            proto.Message
              .InteractiveMessage
              .Body.fromObject({
                text:
                  String(
                    text || ''
                  )
              }),

          footer:
            proto.Message
              .InteractiveMessage
              .Footer.fromObject({
                text:
                  String(
                    footer || ''
                  )
              }),

          nativeFlowMessage:
            proto.Message
              .InteractiveMessage
              .NativeFlowMessage
              .fromObject({
                buttons:
                  nativeButtons,

                messageParamsJson:
                  '{}',

                messageVersion:
                  1
              })
        });

    return this.#relay(
      jid,
      {
        interactiveMessage:
          interactive
      },
      quoted
    );
  }

  async sendCarousel({
    jid,
    text,
    footer,
    cards,
    quoted
  }) {
    if (
      !Array.isArray(cards) ||
      cards.length < 1 ||
      cards.length > 10
    ) {
      throw new AppError(
        'A carousel must contain between one and ten cards.',
        400,
        'INVALID_CAROUSEL'
      );
    }

    const preparedCards = [];

    for (
      const card of cards
    ) {
      /*
       * IMPORTANT:
       *
       * Carousel buttons are deliberately disabled.
       *
       * We keep nativeFlowMessage on the card because
       * the carousel card structure still expects it.
       *
       * An empty buttons array means:
       * - carousel card remains valid
       * - carousel can still be delivered
       * - no Open/Select/CTA button is displayed
       * - card.buttons from the application config is ignored
       */
      const cardMessage = {
        body: {
          text:
            String(
              card.body || ''
            )
        },

        footer: {
          text:
            String(
              card.footer ||
              footer ||
              ''
            )
        },

        nativeFlowMessage: {
          buttons: [],

          messageParamsJson:
            '{}',

          messageVersion:
            1
        }
      };

      if (card.image) {
        const media =
          await prepareWAMessageMedia(
            {
              image: {
                url:
                  String(
                    card.image
                  )
              }
            },
            {
              upload:
                this.sock
                  .waUploadToServer,

              logger:
                this.logger
            }
          );

        cardMessage.header = {
          title:
            String(
              card.title ||
              ''
            ),

          hasMediaAttachment:
            true,

          ...media
        };
      } else {
        cardMessage.header = {
          title:
            String(
              card.title ||
              ''
            ),

          hasMediaAttachment:
            false
        };
      }

      preparedCards.push(
        proto.Message
          .InteractiveMessage
          .fromObject(
            cardMessage
          )
      );
    }

    const interactive =
      proto.Message
        .InteractiveMessage
        .fromObject({
          body: {
            text:
              String(
                text || ''
              )
          },

          footer: {
            text:
              String(
                footer || ''
              )
          },

          carouselMessage:
            proto.Message
              .InteractiveMessage
              .CarouselMessage
              .fromObject({
                cards:
                  preparedCards
              })
        });

    return this.#relay(
      jid,
      {
        interactiveMessage:
          interactive
      },
      quoted
    );
  }

  async sendText(
    jid,
    text,
    options = {}
  ) {
    return this.sock.sendMessage(
      jid,
      {
        text:
          String(text)
      },
      options
    );
  }

  async sendImage(
    jid,
    image,
    caption = '',
    options = {}
  ) {
    return this.sock.sendMessage(
      jid,
      {
        image,
        caption:
          String(
            caption || ''
          )
      },
      options
    );
  }

  async sendDocument(
    jid,
    document,
    mimetype,
    fileName,
    caption = '',
    options = {}
  ) {
    return this.sock.sendMessage(
      jid,
      {
        document,
        mimetype,
        fileName,
        caption:
          String(
            caption || ''
          )
      },
      options
    );
  }

  async sendEvent(
    jid,
    event,
    options = {}
  ) {
    return this.sock.sendMessage(
      jid,
      {
        event
      },
      options
    );
  }

  async sendPoll(
    jid,
    poll,
    options = {}
  ) {
    return this.sock.sendMessage(
      jid,
      {
        poll
      },
      options
    );
  }

  async sendMenu({
    jid,
    intro,
    footer,
    sections,
    quoted
  }) {
    return this.sendInteractive({
      jid,

      text:
        intro,

      footer,

      buttons: [
        this.selectButton(
          'Open menu',
          sections
        )
      ],

      quoted
    });
  }

  async sendReference({
    jid,
    name,
    phone,
    code,
    footer,
    intro,
    quoted
  }) {
    const text =
      `${intro}\n\n` +
      `Name: ${name}\n` +
      `WhatsApp: +${phone}\n` +
      `Reference: ${code}`;

    return this.sendInteractive({
      jid,

      text,

      footer,

      buttons: [
        this.copyButton(
          'Copy reference',
          `copy:${code}`,
          code
        )
      ],

      quoted
    });
  }

  async sendActionMessage({
    jid,
    text,
    footer,
    actions,
    quoted
  }) {
    return this.sendInteractive({
      jid,
      text,
      footer,
      buttons: actions,
      quoted
    });
  }
}
