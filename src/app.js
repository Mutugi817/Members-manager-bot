import Fastify from "fastify";
import helmet from "@fastify/helmet";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Database } from "./database/database.js";
import { SettingsService } from "./whatsapp/settings.js";
import { MemberService } from "./members/service.js";
import { WhatsAppClient } from "./whatsapp/client.js";
import { MemberFlow } from "./whatsapp/flow.js";
import { MenuBuilder } from "./whatsapp/menu.js";
import { MessageHandler } from "./whatsapp/handler.js";
import { MemberListNotifier } from "./whatsapp/member-list-notifier.js";
import { OutreachService } from "./outreach/service.js";
import { SchedulerService } from "./scheduler.js";
import { registerAuth } from "./web/auth.js";
import { registerRoutes } from "./web/routes.js";
import { safeError } from "./core/errors.js";

const here = path.dirname(fileURLToPath(import.meta.url));

const publicDir = path.resolve(here, "../public");

export async function buildApp({ config, logger }) {
  const app = Fastify({
    loggerInstance: logger,

    trustProxy: config.trustProxy,

    bodyLimit: 2 * 1024 * 1024,
  });

  await app.register(jwt, {
    secret: config.jwtSecret,
  });

  await app.register(rateLimit, {
    global: true,

    max: 180,

    timeWindow: "1 minute",
  });

  /*
   * Helmet security configuration.
   *
   * The application is currently served directly over HTTP.
   * Therefore HSTS and upgrade-insecure-requests are disabled.
   *
   * When HTTPS is configured later, these should be restored.
   */
  await app.register(helmet, {
    hsts: false,

    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],

        baseUri: ["'self'"],

        formAction: ["'self'"],

        frameAncestors: ["'self'"],

        objectSrc: ["'none'"],

        imgSrc: ["'self'", "data:", "blob:", "https:"],

        styleSrc: ["'self'", "'unsafe-inline'", "https:"],

        fontSrc: ["'self'", "https:", "data:"],

        scriptSrc: ["'self'", "'unsafe-inline'", "https:"],

        scriptSrcAttr: ["'none'"],

        connectSrc: ["'self'"],

        upgradeInsecureRequests: null,
      },
    },
  });

  await app.register(multipart, {
    limits: {
      fileSize: config.maxUploadBytes,

      files: 1,
    },
  });

  await app.register(fastifyStatic, {
    root: publicDir,

    prefix: "/",
  });

  const database = new Database({
    config,
    logger,
  });

  await database.init();

  const settings = new SettingsService({
    store: database.settings,

    config,
  });

  await settings.init();

  const members = new MemberService({
    store: database.members,

    config,
  });

  const whatsapp = new WhatsAppClient({
    config,
    logger,
  });

  const memberListNotifier = new MemberListNotifier({
    members,
    whatsapp,
    config,
    logger,
  });

  members.on("member:registered", (member) => {
    void memberListNotifier.notify("registered", member);
  });

  members.on("member:updated", (member) => {
    void memberListNotifier.notify("updated", member);
  });

  members.on("member:deleted", (member) => {
    void memberListNotifier.notify("deleted", member);
  });

  const renderer = () => whatsapp.renderer;

  const menu = new MenuBuilder({
    config,
    settings: () => settings.peek(),
  });

  const flow = new MemberFlow({
    members,
    whatsapp,
    config,
  });

  const handler = new MessageHandler({
    config,
    members,
    flow,
    menu,
    whatsapp,
    settings: () => settings.peek(),
  });

  const outreach = new OutreachService({
    whatsapp,
    members,
    config,
    settings,
  });

  const scheduler = new SchedulerService({
    store: database.reminders,

    config,

    outreach,

    whatsapp,
  });

  await scheduler.init();

  const auth = registerAuth(app, config);

  registerRoutes({
    app,
    config,

    requireAdmin: auth.requireAdmin,

    members,
    whatsapp,
    outreach,
    scheduler,
    settings,
  });

  app.get("/health", async () => ({
    ok: true,

    app: config.appName,

    whatsapp: whatsapp.status().status,

    time: new Date().toISOString(),
  }));

  app.get("/", async (_request, reply) => reply.sendFile("index.html"));

  app.setErrorHandler((error, request, reply) => {
    const safe = safeError(error);

    if (safe.statusCode >= 500) {
      logger.error(
        {
          err: error,

          requestId: request.id,
        },
        "Request failed",
      );
    }

    if (!reply.sent) {
      return reply.code(safe.statusCode).send({
        error: safe.message,

        code: safe.code,
      });
    }
  });

  await whatsapp.start((message) => handler.handle(message));

  app.decorate("services", {
    database,
    settings,
    members,
    whatsapp,
    outreach,
    scheduler,
    renderer,
    memberListNotifier,
  });

  return app;
}
