
import fs from 'node:fs/promises';
import path from 'node:path';

import makeWASocket, {
  Browsers,
  DisconnectReason,
  useMultiFileAuthState
} from '@whiskeysockets/baileys';

const authDir = path.resolve(
  process.env.WHATSAPP_AUTH_DIR ||
    path.join(
      process.cwd(),
      'data',
      'whatsapp-auth'
    )
);

const outputFile = path.resolve(
  process.env.GROUPS_JSON_FILE ||
    path.join(
      process.cwd(),
      'data',
      'whatsapp-groups.json'
    )
);

/*
 * Explicit UTF-8 output.
 *
 * Node already uses UTF-8 for strings, but keeping the
 * encoding explicit makes the intention clear and avoids
 * accidentally using a different stream encoding.
 */
process.stdout.setDefaultEncoding('utf8');
process.stderr.setDefaultEncoding('utf8');

let shuttingDown = false;
let finished = false;

function print(text = '') {
  process.stdout.write(
    `${String(text)}\n`,
    'utf8'
  );
}

function normalizeUnicode(value) {
  return String(
    value ?? ''
  ).normalize('NFC');
}

function formatGroup(group) {
  return {
    id:
      normalizeUnicode(
        group.id
      ),

    subject:
      normalizeUnicode(
        group.subject ||
          'Unnamed group'
      ),

    owner:
      group.owner
        ? normalizeUnicode(
            group.owner
          )
        : null,

    size:
      Number(
        group.size ??
          group.participants
            ?.length ??
          0
      ),

    addressingMode:
      group.addressingMode
        ? normalizeUnicode(
            group.addressingMode
          )
        : null
  };
}

async function saveGroups(groups) {
  await fs.mkdir(
    path.dirname(
      outputFile
    ),
    {
      recursive:
        true
    }
  );

  /*
   * JSON.stringify preserves Unicode characters.
   *
   * Example:
   * "🙏 Grace Encounter 🇰🇪"
   *
   * stays exactly that instead of becoming:
   * "\\ud83d\\ude4f Grace Encounter \\ud83c\\uddf0\\ud83c\\uddea"
   */
  const json =
    JSON.stringify(
      {
        generatedAt:
          new Date()
            .toISOString(),

        generatedAtEAT:
          new Intl.DateTimeFormat(
            'en-KE',
            {
              timeZone:
                'Africa/Nairobi',

              dateStyle:
                'full',

              timeStyle:
                'long'
            }
          ).format(
            new Date()
          ),

        totalGroups:
          groups.length,

        groups
      },
      null,
      2
    );

  await fs.writeFile(
    outputFile,
    `${json}\n`,
    {
      encoding:
        'utf8'
    }
  );
}

function printGroups(groups) {
  print('');
  print(
    '╔══════════════════════════════════════════════╗'
  );
  print(
    '║           AVAILABLE WHATSAPP GROUPS          ║'
  );
  print(
    '╚══════════════════════════════════════════════╝'
  );
  print('');

  if (
    groups.length === 0
  ) {
    print(
      'No WhatsApp groups were found.'
    );
    print('');
    return;
  }

  groups.forEach(
    (
      group,
      index
    ) => {
      print(
        `#${index + 1}`
      );

      print(
        `Name:    ${group.subject}`
      );

      print(
        `JID:     ${group.id}`
      );

      print(
        `Members: ${group.size}`
      );

      if (
        group.owner
      ) {
        print(
          `Owner:   ${group.owner}`
        );
      }

      if (
        group.addressingMode
      ) {
        print(
          `Mode:    ${group.addressingMode}`
        );
      }

      print(
        '────────────────────────────────────────────'
      );
    }
  );

  print('');
  print(
    `Total groups: ${groups.length}`
  );

  print('');
  print(
    `JSON file: ${outputFile}`
  );

  print('');
}

async function closeSocket(
  sock
) {
  if (
    shuttingDown
  ) {
    return;
  }

  shuttingDown =
    true;

  try {
    sock.end(
      undefined
    );
  } catch {
    /*
     * The socket is only being closed because
     * this utility has completed its work.
     */
  }
}

async function main() {
  await fs.mkdir(
    authDir,
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
      authDir
    );

  const sock =
    makeWASocket({
      auth:
        state,

      browser:
        Browsers.ubuntu(
          'Grace Encounter Members Manager'
        ),

      /*
       * Do NOT use printQRInTerminal.
       *
       * It is deprecated in Baileys 7.
       *
       * We are using connection.update below.
       */
      markOnlineOnConnect:
        false,

      syncFullHistory:
        false
    });

  sock.ev.on(
    'creds.update',
    saveCreds
  );

  sock.ev.on(
    'connection.update',
    async ({
      connection,
      lastDisconnect,
      qr
    }) => {
      if (qr) {
        print('');
        print(
          'A WhatsApp QR code is available.'
        );

        print(
          'This utility is using the existing authentication folder.'
        );

        print(
          `Auth directory: ${authDir}`
        );

        print('');
        print(
          'For a fresh login, use the main application QR/pairing interface.'
        );

        print('');
      }

      if (
        connection ===
        'connecting'
      ) {
        print(
          'Connecting to WhatsApp...'
        );
      }

      if (
        connection ===
        'open'
      ) {
        print('');
        print(
          'WhatsApp connected.'
        );
        print('');

        try {
          const result =
            await sock
              .groupFetchAllParticipating();

          const groups =
            Object.values(
              result || {}
            )
              .map(
                formatGroup
              )
              .sort(
                (a, b) =>
                  a.subject.localeCompare(
                    b.subject,
                    undefined,
                    {
                      sensitivity:
                        'base'
                    }
                  )
              );

          printGroups(
            groups
          );

          await saveGroups(
            groups
          );

          finished =
            true;

          await closeSocket(
            sock
          );

          /*
           * Give the socket event loop a chance to settle,
           * but do not wait for another reconnect cycle.
           */
          setTimeout(
            () => {
              process.exit(
                0
              );
            },
            150
          );
        } catch (
          error
        ) {
          print('');
          print(
            'Failed to fetch WhatsApp groups.'
          );

          print(
            error?.stack ||
              error?.message ||
              String(error)
          );

          await closeSocket(
            sock
          );

          setTimeout(
            () => {
              process.exit(
                1
              );
            },
            150
          );
        }
      }

      if (
        connection ===
          'close' &&
        !finished
      ) {
        const code =
          lastDisconnect
            ?.error
            ?.output
            ?.statusCode ??
          null;

        if (
          code ===
          DisconnectReason.loggedOut
        ) {
          print('');
          print(
            'WhatsApp session is logged out.'
          );

          print(
            `Auth directory: ${authDir}`
          );

          print('');
          process.exit(
            1
          );
        }

        print('');
        print(
          'WhatsApp connection closed before the groups could be retrieved.'
        );

        print(
          `Disconnect code: ${code ?? 'unknown'}`
        );

        print('');

        process.exit(
          1
        );
      }

      /*
       * When we deliberately call sock.end() after successfully
       * retrieving the groups, Baileys emits connection === close.
       *
       * That is an expected shutdown, so we intentionally do
       * nothing here when `finished === true`.
       */
    }
  );
}

main().catch(
  (error) => {
    print(
      error?.stack ||
        error?.message ||
        String(error)
    );

    process.exit(
      1
    );
  }
);
