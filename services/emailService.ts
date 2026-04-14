import nodemailer from "nodemailer";
import "dotenv/config";

const normalizeEnv = (value: string | undefined): string =>
  String(value || "")
    .trim()
    .replace(/^['"]+|['"]+$/g, "");

const SMTP_HOST = normalizeEnv(process.env.SMTP_HOST) || "smtp.gmail.com";
const SMTP_PORT = Number(normalizeEnv(process.env.SMTP_PORT) || "587");
const SMTP_USER = normalizeEnv(process.env.SMTP_USER) || normalizeEnv(process.env.EMAIL);
const SMTP_PASSWORD =
  normalizeEnv(process.env.SMTP_PASSWORD) || normalizeEnv(process.env.EMAIL_PASSWORD);
const SMTP_FROM = normalizeEnv(process.env.SMTP_FROM) || `CarSure DZ <${SMTP_USER}>`;
const SMTP_SECURE = process.env.SMTP_SECURE === "true" || SMTP_PORT === 465;
const RESEND_API_KEY = normalizeEnv(process.env.RESEND_API_KEY);
const RESEND_FROM = normalizeEnv(process.env.RESEND_FROM) || SMTP_FROM;
const USE_RESEND_PRIMARY =
  normalizeEnv(process.env.EMAIL_PROVIDER).toLowerCase() === "resend" || !!RESEND_API_KEY;
const IS_GMAIL_HOST = /gmail\.com$/i.test(SMTP_HOST);

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

const buildTransporter = (
  host: string,
  port: number,
  secure: boolean
): nodemailer.Transporter =>
  nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASSWORD,
    },
    tls: {
      minVersion: "TLSv1.2",
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
  });

const sendWithResend = async (to: string, code: string): Promise<boolean> => {
  if (!RESEND_API_KEY) {
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
        subject: "Confirmation de votre email - CarSure DZ",
        html: htmlTemplate(code),
      }),
    });

    const body = await response.text();
    if (!response.ok) {
      console.error("❌ Resend API send failed:", response.status, body);
      return false;
    }
    console.log(`✅ Verification email sent via Resend to: ${to}`);
    return true;
  } catch (error: any) {
    console.error("❌ Resend API error:", error?.message || error);
    return false;
  }
};

// Create transporter only if credentials are available
let transporter: nodemailer.Transporter | null = null;

if (!USE_RESEND_PRIMARY && SMTP_USER && SMTP_PASSWORD) {
  transporter = buildTransporter(SMTP_HOST, SMTP_PORT, SMTP_SECURE);
  console.log(
    `✅ Email service configured (${SMTP_HOST}:${SMTP_PORT}, secure=${SMTP_SECURE}) with user ${SMTP_USER}`
  );

  void transporter
    .verify()
    .then(() => {
      console.log("✅ SMTP connection verified successfully.");
    })
    .catch((err: any) => {
      console.error("❌ SMTP verify failed:", err?.message || err);
      if (err?.code) {
        console.error(`   SMTP error code: ${err.code}`);
      }
    });
} else {
  if (USE_RESEND_PRIMARY && RESEND_API_KEY) {
    console.log("✅ Email provider set to Resend (primary).");
  } else {
    console.warn("⚠️ SMTP_USER or SMTP_PASSWORD not configured.");
  }
  if (!RESEND_API_KEY && !SMTP_PASSWORD) {
    console.warn("⚠️ No RESEND_API_KEY configured either. Email sending is disabled.");
  } else if (RESEND_API_KEY) {
    console.log("ℹ️ RESEND_API_KEY detected. Email will use Resend HTTPS API fallback.");
  }
}

export const sendVerificationEmail = async (to: string, code: string): Promise<boolean> => {
  const normalizedTo = normalizeEnv(to).toLowerCase();
  if (!normalizedTo) {
    console.error("❌ Cannot send email: recipient is empty");
    return false;
  }

  if (USE_RESEND_PRIMARY && RESEND_API_KEY) {
    console.log("📧 Sending verification email with Resend (primary)...");
    return sendWithResend(normalizedTo, code);
  }

  if (!transporter) {
    console.warn("⚠️ SMTP transporter unavailable, trying Resend fallback...");
    return sendWithResend(normalizedTo, code);
  }

  const mailOptions = {
    from: SMTP_FROM,
    to: normalizedTo,
    subject: "Confirmation de votre email - CarSure DZ",
    html: htmlTemplate(code),
  };

  try {
    console.log(`📧 Attempting SMTP send to ${normalizedTo} via ${SMTP_HOST}:${SMTP_PORT} secure=${SMTP_SECURE}`);
    const info = await transporter.sendMail(mailOptions);
    console.log(
      `✅ Verification email sent to: ${normalizedTo} (messageId: ${info.messageId || "n/a"})`
    );
    return true;
  } catch (error: any) {
    console.error("❌ Error sending email:", error?.message || error);
    if (error?.code === "EAUTH") {
      console.error("   Authentication failed. Please check SMTP_PASSWORD in .env");
      console.error("   For Gmail, you need to use an App Password, not your regular password.");
      console.error("   Steps: Google Account > Security > 2-Step Verification > App Passwords");
    }
    if (error?.code === "ECONNECTION" || error?.code === "ETIMEDOUT") {
      console.error(`   Connection issue to ${SMTP_HOST}:${SMTP_PORT}. Check firewall/port and SMTP_HOST.`);
    }
    if (error?.response) {
      console.error("   SMTP server response:", error.response);
    }
    if (error?.command) {
      console.error("   SMTP command:", error.command);
    }

    // Common Render issue with Gmail STARTTLS on 587: retry SSL on 465.
    if (IS_GMAIL_HOST && SMTP_PORT === 587 && (error?.code === "ECONNECTION" || error?.code === "ETIMEDOUT")) {
      try {
        console.log("↻ Retrying SMTP with smtp.gmail.com:465 secure=true...");
        const fallbackTransporter = buildTransporter("smtp.gmail.com", 465, true);
        const info = await fallbackTransporter.sendMail(mailOptions);
        console.log(
          `✅ Verification email sent via fallback 465 to: ${normalizedTo} (messageId: ${info.messageId || "n/a"})`
        );
        return true;
      } catch (fallbackError: any) {
        console.error("❌ Fallback SMTP 465 failed:", fallbackError?.message || fallbackError);
      }
    }

    if (RESEND_API_KEY) {
      console.log("↻ Trying Resend HTTPS fallback...");
      const resendOk = await sendWithResend(normalizedTo, code);
      if (resendOk) return true;
    }

    return false;
  }
};
