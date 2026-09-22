import { AppError } from "../core/errors.js";
import { timingSafeEqualText } from "../core/utils.js";

export function registerAuth(app, config) {
  app.post(
    "/api/auth/login",
    {
      config: {
        rateLimit: {
          max: 8,
          timeWindow: "1 minute",
        },
      },
    },
    async (request, reply) => {
      const email = String(request.body?.email || "")
        .trim()
        .toLowerCase();

      const password = String(request.body?.password || "");

      if (!email || !password) {
        throw new AppError(
          "Enter your email and password.",
          400,
          "LOGIN_REQUIRED",
        );
      }

      const validEmail = email === config.adminEmail;

      const validPassword = timingSafeEqualText(password, config.adminPassword);

      if (!validEmail || !validPassword) {
        throw new AppError(
          "The email or password is not correct.",
          401,
          "INVALID_LOGIN",
        );
      }

      const token = await reply.jwtSign(
        {
          sub: "admin",
          email,
          role: "admin",
        },
        {
          expiresIn: "12h",
        },
      );

      /*
       * Authentication is now completely token-based.
       *
       * The token is returned to the frontend and the frontend
       * sends it using:
       *
       * Authorization: Bearer <token>
       *
       * No authentication cookie is created.
       */
      return {
        ok: true,
        token,
      };
    },
  );

  app.post("/api/auth/logout", async () => ({
    ok: true,
  }));

  async function requireAdmin(request) {
    const authorization = String(request.headers.authorization || "").trim();

    const match = authorization.match(/^Bearer\s+(.+)$/i);

    const token = match?.[1]?.trim() || "";

    if (!token) {
      throw new AppError("Please sign in.", 401, "AUTH_REQUIRED");
    }

    try {
      const decoded = await request.server.jwt.verify(token);

      if (decoded?.role !== "admin") {
        throw new Error("invalid role");
      }

      request.admin = decoded;
    } catch {
      throw new AppError("Please sign in again.", 401, "AUTH_REQUIRED");
    }
  }

  app.get(
    "/api/auth/me",
    {
      preHandler: requireAdmin,
    },
    async (request) => ({
      ok: true,
      email: request.admin.email,
    }),
  );

  return {
    requireAdmin,
  };
}
