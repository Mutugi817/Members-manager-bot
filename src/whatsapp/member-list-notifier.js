
import { AppError } from '../core/errors.js';
import { nowIso } from '../core/utils.js';

function cleanDisplay(
  value,
  fallback = ''
) {
  const text =
    String(
      value ?? ''
    )
      .replace(
        /\r/g,
        ''
      )
      .replace(
        /\n+/g,
        ' '
      )
      .trim();

  return (
    text ||
    fallback
  );
}

function formatTimestamp(
  timestamp,
  timeZone
) {
  const date =
    new Date(
      timestamp
    );

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return 'Unknown time';
  }

  const formatter =
    new Intl.DateTimeFormat(
      'en-KE',
      {
        timeZone,

        day:
          '2-digit',

        month:
          'long',

        year:
          'numeric',

        hour:
          '2-digit',

        minute:
          '2-digit',

        hourCycle:
          'h23'
      }
    );

  return (
    formatter.format(
      date
    ) +
    ' EAT'
  );
}

function changeHeading(
  type
) {
  if (
    type ===
    'registered'
  ) {
    return {
      title:
        'NEW MEMBER REGISTERED',

      icon:
        '🎉'
    };
  }

  if (
    type ===
    'updated'
  ) {
    return {
      title:
        'MEMBER DETAILS UPDATED',

      icon:
        '📝'
    };
  }

  if (
    type ===
    'deleted'
  ) {
    return {
      title:
        'MEMBERSHIP RECORD REMOVED',

      icon:
        '🗑️'
    };
  }

  return {
    title:
      'MEMBERSHIP REGISTER UPDATED',

    icon:
      '📋'
  };
}

export class MemberListNotifier {
  constructor({
    members,
    whatsapp,
    config,
    logger
  }) {
    this.members =
      members;

    this.whatsapp =
      whatsapp;

    this.config =
      config;

    this.logger =
      logger;
  }

  enabled() {
    return Boolean(
      this.config
        .membersGroupNotifications &&
      this.config
        .membersGroupJid
    );
  }

  async notify(
    type,
    member
  ) {
    if (
      !this.enabled()
    ) {
      return null;
    }

    const groupJid =
      this.config
        .membersGroupJid;

    if (
      !groupJid
    ) {
      throw new AppError(
        'Members notification group is not configured.',
        500,
        'MEMBERS_GROUP_NOT_CONFIGURED'
      );
    }

    const activeMembers =
      this.members
        .list({
          status:
            'active'
        })
        .slice()
        .sort(
          (a, b) =>
            String(
              a.code ||
                ''
            ).localeCompare(
              String(
                b.code ||
                  ''
              ),
              undefined,
              {
                numeric:
                  true,

                sensitivity:
                  'base'
              }
            )
        );

    const generatedAt =
      nowIso();

    const message =
      this.#buildMessage({
        type,
        member,
        activeMembers,
        generatedAt
      });

    try {
      const result =
        await this.whatsapp
          .sendToJid(
            groupJid,
            {
              kind:
                'text',

              text:
                message
            }
          );

      this.logger.info(
        {
          type,

          memberId:
            member?.id ??
            null,

          memberCode:
            member?.code ??
            null,

          groupJid,

          memberCount:
            activeMembers.length,

          messageId:
            result?.messageId ??
            null
        },
        'Automatic member-list notification sent'
      );

      return result;
    } catch (
      error
    ) {
      this.logger.error(
        {
          err:
            error,

          type,

          memberId:
            member?.id ??
            null,

          memberCode:
            member?.code ??
            null,

          groupJid
        },
        'Automatic member-list notification failed'
      );

      return null;
    }
  }

  #buildMessage({
    type,
    member,
    activeMembers,
    generatedAt
  }) {
    const heading =
      changeHeading(
        type
      );

    const changedMember =
      cleanDisplay(
        member?.fullName,
        'Member'
      );

    const changedCode =
      cleanDisplay(
        member?.code,
        'N/A'
      );

    const timestamp =
      formatTimestamp(
        generatedAt,
        this.config
          .membersGroupTimezone
      );

    const lines = [];

    lines.push(
      '✨𝗚𝗥𝗔𝗖𝗘 𝗘𝗡𝗖𝗢𝗨𝗡𝗧𝗘𝗥'
    );

    lines.push(
      '📖 𝗠𝗘𝗠𝗕𝗘𝗥𝗦𝗛𝗜𝗣 𝗥𝗘𝗚𝗜𝗦𝗧𝗘𝗥'
    );

    lines.push('');

    lines.push(
      `${heading.icon} *${heading.title}*`
    );

    lines.push('');

    if (
      type ===
      'registered'
    ) {
      lines.push(
        '🙏 We warmly welcome a new member into the Grace Encounter family.'
      );
    } else if (
      type ===
      'updated'
    ) {
      lines.push(
        '✅ A member has successfully updated their membership details.'
      );
    } else if (
      type ===
      'deleted'
    ) {
      lines.push(
        'ℹ️ A membership record has been permanently removed from the register.'
      );
    } else {
      lines.push(
        '📋 The Grace Encounter membership register has been updated.'
      );
    }

    lines.push('');

    lines.push(
      `*Member:* ${changedMember}`
    );

    lines.push(
      `*Reference:* ${changedCode} ✅`
    );

    lines.push('');

    lines.push(
      '👥 𝗖𝗨𝗥𝗥𝗘𝗡𝗧 𝗠𝗘𝗠𝗕𝗘𝗥𝗦'
    );

    lines.push('');

    if (
      activeMembers.length ===
      0
    ) {
      lines.push(
        '📭 _There are currently no registered members._'
      );
    } else {
      activeMembers.forEach(
        (
          currentMember,
          index
        ) => {
          const name =
            cleanDisplay(
              currentMember.fullName,
              'Unnamed member'
            );

          const code =
            cleanDisplay(
              currentMember.code,
              'N/A'
            );

          lines.push(
            `${index + 1}. ${name} — *${code}* ✅`
          );
        }
      );
    }

    lines.push('');

    lines.push(
      `👥 *Total Registered:* ${activeMembers.length}`
    );

    lines.push(
      '🙏 *Grace Encounter Family*'
    );

    lines.push('');

    lines.push(
      `🕐 *${timestamp}*`
    );

    return lines.join(
      '\n'
    );
  }
}
