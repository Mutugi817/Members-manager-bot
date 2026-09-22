import path from "node:path";

import { bool, number, required } from "./utils.js";

export function loadConfig() {
  const root = process.cwd();

  const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, "data"));

  const membersGroupJid = String(process.env.MEMBERS_GROUP_JID || "").trim();

  const membersGroupNotifications = bool(
    process.env.MEMBERS_GROUP_NOTIFICATIONS,
    true,
  );

  const membersGroupTimezone =
    String(process.env.MEMBERS_GROUP_TIMEZONE || "Africa/Nairobi").trim() ||
    "Africa/Nairobi";

  const config = {
    nodeEnv: process.env.NODE_ENV || "development",

    host: process.env.HOST || "127.0.0.1",

    port: number(process.env.PORT, 4000),

    logLevel: process.env.LOG_LEVEL || "info",

    trustProxy: bool(process.env.TRUST_PROXY, false),

    appName: process.env.APP_NAME || "Grace Encounter Members Manager",

    churchName: process.env.CHURCH_NAME || "Grace Encounter",

    eventName: process.env.EVENT_NAME || "Uhuru Park Gathering",

    eventLocation: process.env.EVENT_LOCATION || "Uhuru Park, Nairobi",

    transportNotice:
      process.env.TRANSPORT_NOTICE ||
      "Free transport from Nakuru to Nairobi for the Uhuru Park gathering.",

    botKeyword: String(process.env.BOT_KEYWORD || "gracehelp")
      .trim()
      .toLowerCase(),

    botFooter: process.env.BOT_FOOTER || "Grace Encounter Members",

    referenceCodePrefix: process.env.REFERENCE_CODE_PREFIX || "GC",

    referenceCodeStart: Math.max(
      1,
      number(process.env.REFERENCE_CODE_START, 1),
    ),

    referenceCodePad: Math.max(1, number(process.env.REFERENCE_CODE_PAD, 3)),

    membersGroupJid,

    membersGroupNotifications,

    membersGroupTimezone,

    adminEmail: String(process.env.ADMIN_EMAIL || "")
      .trim()
      .toLowerCase(),

    adminPassword: process.env.ADMIN_PASSWORD || "",

    /*
     * JWT is now the only authentication
     * secret required by the dashboard.
     */
    jwtSecret: required("JWT_SECRET", 32),

    dataDir,

    membersFile: path.resolve(
      process.env.MEMBERS_FILE || path.join(dataDir, "members.json"),
    ),

    settingsFile: path.resolve(
      process.env.SETTINGS_FILE || path.join(dataDir, "settings.json"),
    ),

    remindersFile: path.resolve(
      process.env.REMINDERS_FILE || path.join(dataDir, "reminders.json"),
    ),

    whatsappAuthDir: path.resolve(
      process.env.WHATSAPP_AUTH_DIR || path.join(dataDir, "whatsapp-auth"),
    ),

    uploadDir: path.resolve(
      process.env.UPLOAD_DIR || path.join(root, "uploads"),
    ),

    seedFile: path.resolve(
      process.env.SEED_FILE || path.join(dataDir, "members.seed.json"),
    ),

    autoSeed: bool(process.env.AUTO_SEED, true),

    enableScheduledMessages: bool(process.env.ENABLE_SCHEDULED_MESSAGES, false),

    outboundDelayMs: Math.max(250, number(process.env.OUTBOUND_DELAY_MS, 900)),

    maxUploadBytes: Math.max(
      1024 * 1024,
      number(process.env.MAX_UPLOAD_BYTES, 5 * 1024 * 1024),
    ),

    welcomeTitle: process.env.WELCOME_TITLE || "Grace Encounter Members",

    welcomeIntro:
      process.env.WELCOME_INTRO || "Welcome. We are glad to serve you.",

    menuTitle: process.env.MENU_TITLE || "Member Menu",

    menuIntro: process.env.MENU_INTRO || "Please choose a service below.",

    allowMemberCommands: bool(process.env.ALLOW_MEMBER_COMMANDS, true),

    allowGroupMenu: bool(process.env.ALLOW_GROUP_MENU, true),
  };

  if (!config.adminEmail || !config.adminPassword) {
    throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD are required.");
  }

  if (!/^[a-z0-9_-]{3,32}$/.test(config.botKeyword)) {
    throw new Error(
      "BOT_KEYWORD must contain only letters, numbers, underscores or hyphens.",
    );
  }

  if (config.membersGroupNotifications && !config.membersGroupJid) {
    throw new Error(
      "MEMBERS_GROUP_JID is required when MEMBERS_GROUP_NOTIFICATIONS=true.",
    );
  }

  if (config.membersGroupJid && !config.membersGroupJid.endsWith("@g.us")) {
    throw new Error(
      "MEMBERS_GROUP_JID must be a WhatsApp group JID ending with @g.us.",
    );
  }

  return Object.freeze(config);
}
