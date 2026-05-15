import "dotenv/config";
import nodemailer from "nodemailer";

const normalizeEnv = (value: string | undefined): string =>
  String(value || "")
    .trim()
    .replace(/^['"]+|['"]+$/g, "");

const RESEND_API_KEY = normalizeEnv(process.env.RESEND_API_KEY);
const RESEND_FROM = normalizeEnv(process.env.RESEND_FROM) || "CarSure DZ <onboarding@resend.dev>";

const SMTP_HOST = normalizeEnv(process.env.SMTP_HOST);
const SMTP_PORT = parseInt(normalizeEnv(process.env.SMTP_PORT) || "587", 10);
/** Full email for auth (Gmail: your.address@gmail.com). Aliases: EMAIL, GMAIL_USER */
const SMTP_USER = normalizeEnv(
  process.env.SMTP_USER || process.env.EMAIL || process.env.GMAIL_USER
);
/**
 * App password / SMTP password. Aliases: EMAIL_PASSWORD, SMTP_PASS, GMAIL_APP_PASSWORD.
 * Gmail app passwords are 16 chars; users often paste "xxxx xxxx xxxx xxxx" — spaces are stripped.
 * If your password contains # or other characters that break .env parsing, set SMTP_PASSWORD_B64
 * to the UTF-8 base64 encoding of the password instead.
 */
const smtpPasswordB64 = normalizeEnv(process.env.SMTP_PASSWORD_B64);
const rawSmtpPassword = smtpPasswordB64
  ? (() => {
      try {
        return Buffer.from(smtpPasswordB64, "base64").toString("utf8");
      } catch {
        return "";
      }
    })()
  : normalizeEnv(
      process.env.SMTP_PASSWORD ||
        process.env.EMAIL_PASSWORD ||
        process.env.SMTP_PASS ||
        process.env.GMAIL_APP_PASSWORD
    );
const SMTP_PASSWORD = rawSmtpPassword.replace(/\s+/g, "");
const SMTP_FROM =
  normalizeEnv(process.env.SMTP_FROM) ||
  (SMTP_USER ? `CarSure DZ <${SMTP_USER}>` : "CarSure DZ <noreply@localhost>");
const SMTP_SECURE =
  normalizeEnv(process.env.SMTP_SECURE).toLowerCase() === "true" || SMTP_PORT === 465;
/** Use STARTTLS on 587 (recommended for Gmail, Outlook, most hosts). */
const SMTP_REQUIRE_TLS =
  normalizeEnv(process.env.SMTP_REQUIRE_TLS).toLowerCase() !== "false" &&
  !SMTP_SECURE &&
  (SMTP_PORT === 587 || SMTP_PORT === 25);

const EMAIL_PROVIDER = normalizeEnv(process.env.EMAIL_PROVIDER).toLowerCase();

const smtpConfigured =
  Boolean(SMTP_HOST && SMTP_USER && SMTP_PASSWORD);

/** Render and many PaaS block outbound SMTP (465/587) — use Resend (HTTPS) in production. */
const isRenderHost =
  normalizeEnv(process.env.RENDER).toLowerCase() === "true" ||
  Boolean(normalizeEnv(process.env.RENDER_SERVICE_NAME));

const useSmtp =
  EMAIL_PROVIDER !== "resend" &&
  (EMAIL_PROVIDER === "smtp" ||
    EMAIL_PROVIDER === "nodemailer" ||
    (smtpConfigured && !RESEND_API_KEY));

/** When SMTP fails but Resend is configured, retry via API (fixes Render SMTP timeouts). */
const canFallbackToResend = Boolean(RESEND_API_KEY);

const passwordResetHtmlTemplate = (code: string): string => `
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9fafb;">
    <div style="background-color: white; border-radius: 8px; padding: 30px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
      <h1 style="color: #0d9488; text-align: center; margin-bottom: 20px;">CarSure DZ</h1>
      <h2 style="color: #1f2937; margin-bottom: 20px;">Réinitialisation du mot de passe</h2>
      <p style="color: #4b5563; line-height: 1.6; margin-bottom: 20px;">Bonjour,</p>
      <p style="color: #4b5563; line-height: 1.6; margin-bottom: 30px;">
        Vous avez demandé à réinitialiser votre mot de passe. Utilisez le code suivant sur le site CarSure DZ :
      </p>
      <div style="background-color: #f0fdfa; border: 2px solid #0d9488; border-radius: 8px; padding: 20px; text-align: center; margin: 30px 0;">
        <p style="font-size: 32px; font-weight: bold; color: #0d9488; letter-spacing: 8px; margin: 0; font-family: monospace;">
          ${String(code).trim()}
        </p>
      </div>
      <p style="color: #6b7280; font-size: 14px; margin-top: 30px;">
        Ce code est valide pendant 15 minutes. Si vous n'avez pas demandé cette réinitialisation, ignorez cet email.
      </p>
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
      <p style="color: #9ca3af; font-size: 12px; text-align: center; margin: 0;">
        © 2024 CarSure DZ. Tous droits reserves.
      </p>
    </div>
  </div>
`;

const htmlTemplate = (code: string): string => `
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9fafb;">
    <div style="background-color: white; border-radius: 8px; padding: 30px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
      <h1 style="color: #0d9488; text-align: center; margin-bottom: 20px;">CarSure DZ</h1>
      <h2 style="color: #1f2937; margin-bottom: 20px;">Confirmation de votre email</h2>
      <p style="color: #4b5563; line-height: 1.6; margin-bottom: 20px;">
        Bonjour,
      </p>
      <p style="color: #4b5563; line-height: 1.6; margin-bottom: 30px;">
        Merci de vous etre inscrit sur CarSure DZ. Veuillez utiliser le code suivant pour confirmer votre adresse email :
      </p>
      <div style="background-color: #f0fdfa; border: 2px solid #0d9488; border-radius: 8px; padding: 20px; text-align: center; margin: 30px 0;">
        <p style="font-size: 32px; font-weight: bold; color: #0d9488; letter-spacing: 8px; margin: 0; font-family: monospace;">
          ${String(code).trim()}
        </p>
      </div>
      <p style="color: #6b7280; font-size: 14px; margin-top: 30px;">
        Ce code est valide pendant 15 minutes. Si vous n'avez pas cree de compte, vous pouvez ignorer cet email.
      </p>
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
      <p style="color: #9ca3af; font-size: 12px; text-align: center; margin: 0;">
        © 2024 CarSure DZ. Tous droits reserves.
      </p>
    </div>
  </div>
`;

const sendWithResend = async (
  to: string,
  subject: string,
  html: string
): Promise<boolean> => {
  if (!RESEND_API_KEY) {
    console.error("❌ RESEND_API_KEY is missing. Cannot send email.");
    return false;
  }
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: [to],
        subject,
        html,
      }),
    });

    const body = await response.text();
    if (!response.ok) {
      console.error("❌ Resend API send failed:", response.status, body);
      return false;
    }
    console.log(`✅ Email sent via Resend to: ${to}`);
    return true;
  } catch (error: any) {
    console.error("❌ Resend API error:", error?.message || error);
    return false;
  }
};

if (useSmtp && smtpConfigured) {
  console.log(`✅ Email provider: SMTP (${SMTP_HOST}:${SMTP_PORT}, secure=${SMTP_SECURE}).`);
  if (isRenderHost) {
    console.warn(
      "⚠️  Running on Render: outbound SMTP (465/587) is often blocked → Connection timeout. " +
        "Set EMAIL_PROVIDER=resend and RESEND_API_KEY in Render Environment (recommended)."
    );
  }
  if (normalizeEnv(process.env.DEBUG_SMTP).toLowerCase() === "true") {
    console.log(
      `[DEBUG_SMTP] auth user=${SMTP_USER} passwordLength=${SMTP_PASSWORD.length} (if too short, check .env: # truncates unquoted values; use single quotes or SMTP_PASSWORD_B64)`
    );
  }
} else if (RESEND_API_KEY) {
  console.log(
    isRenderHost
      ? "✅ Email provider: Resend (recommended for Render)."
      : "✅ Email provider: Resend."
  );
} else {
  console.warn(
    "⚠️ No email provider: set SMTP_* + EMAIL_PROVIDER=smtp, or RESEND_API_KEY for Resend."
  );
}

const sendWithSmtp = async (
  to: string,
  subject: string,
  html: string
): Promise<boolean> => {
  if (!smtpConfigured) {
    console.error("❌ SMTP is not fully configured (SMTP_HOST, SMTP_USER, SMTP_PASSWORD).");
    return false;
  }
  try {
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      requireTLS: SMTP_REQUIRE_TLS,
      tls: {
        minVersion: "TLSv1.2" as const,
      },
      connectionTimeout: 30_000,
      greetingTimeout: 30_000,
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASSWORD,
      },
    });
    await transporter.sendMail({
      from: SMTP_FROM,
      to,
      subject,
      html,
    });
    console.log(`✅ Email sent via SMTP to: ${to}`);
    return true;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("❌ SMTP send error:", msg);
    if (/535|Invalid login|authentication failed/i.test(msg)) {
      console.error(
        "   Hint (535): Wrong SMTP credentials or mailbox password. If SMTP_PASSWORD contains # use single quotes in .env: SMTP_PASSWORD='...' or SMTP_PASSWORD_B64=... For Gmail use an App Password (not your Google account password)."
      );
    }
    return false;
  }
};

const sendEmail = async (to: string, subject: string, html: string): Promise<boolean> => {
  if (useSmtp && smtpConfigured) {
    const smtpOk = await sendWithSmtp(to, subject, html);
    if (smtpOk) return true;
    if (canFallbackToResend) {
      console.warn("⚠️  SMTP failed — retrying with Resend API...");
      return sendWithResend(to, subject, html);
    }
    return false;
  }
  return sendWithResend(to, subject, html);
};

export const sendVerificationEmail = async (to: string, code: string): Promise<boolean> => {
  const normalizedTo = normalizeEnv(to).toLowerCase();
  if (!normalizedTo) {
    console.error("❌ Cannot send email: recipient is empty");
    return false;
  }
  if (useSmtp && smtpConfigured) {
    console.log("📧 Sending verification email via SMTP...");
  } else {
    console.log("📧 Sending verification email via Resend...");
  }
  return sendEmail(
    normalizedTo,
    "Confirmation de votre email - CarSure DZ",
    htmlTemplate(code)
  );
};

export const sendPasswordResetEmail = async (to: string, code: string): Promise<boolean> => {
  const normalizedTo = normalizeEnv(to).toLowerCase();
  if (!normalizedTo) {
    console.error("❌ Cannot send email: recipient is empty");
    return false;
  }
  if (useSmtp && smtpConfigured) {
    console.log("📧 Sending password reset email via SMTP...");
  } else {
    console.log("📧 Sending password reset email via Resend...");
  }
  return sendEmail(
    normalizedTo,
    "Réinitialisation du mot de passe - CarSure DZ",
    passwordResetHtmlTemplate(code)
  );
};
