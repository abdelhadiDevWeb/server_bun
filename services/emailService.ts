import nodemailer from "nodemailer";
import "dotenv/config";

/** Trim + strip accidental quotes from .env lines like PASSWORD="abc" or PASSWORD = x */
function envClean(v: string | undefined): string {
  if (!v) return "";
  return v
    .trim()
    .replace(/^['"]+|['"]+$/g, "")
    .replace(/^=+/, "");
}

const SMTP_USER = envClean(
  process.env.SMTP_USER || process.env.EMAIL || "abdouhadi2002@gmail.com"
);
const SMTP_PASSWORD = envClean(
  process.env.SMTP_PASSWORD || process.env.EMAIL_PASSWORD
);
const SMTP_HOST = envClean(process.env.SMTP_HOST);
const SMTP_PORT_RAW = envClean(process.env.SMTP_PORT);
const SMTP_PORT = SMTP_PORT_RAW ? parseInt(SMTP_PORT_RAW, 10) : 587;

function buildSmtpTransport(): nodemailer.Transporter | null {
  if (!SMTP_USER || !SMTP_PASSWORD) {
    return null;
  }

  // Prefer explicit host/port from .env (matches Gmail + most providers)
  if (SMTP_HOST) {
    const port = Number.isFinite(SMTP_PORT) && SMTP_PORT > 0 ? SMTP_PORT : 587;
    const secure = port === 465;
    return nodemailer.createTransport({
      host: SMTP_HOST,
      port,
      secure,
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASSWORD,
      },
      ...(port === 587
        ? { requireTLS: true, tls: { minVersion: "TLSv1.2" as const } }
        : {}),
    });
  }

  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASSWORD,
    },
  });
}

let transporter: nodemailer.Transporter | null = buildSmtpTransport();

if (transporter) {
  console.log(
    `✅ Email service configured (${SMTP_HOST ? `host=${SMTP_HOST} port=${SMTP_PORT}` : "service=gmail"}) user=${SMTP_USER}`
  );
} else {
  console.warn("⚠️  SMTP_USER or SMTP_PASSWORD not configured. Email sending will be disabled.");
  console.warn("   Add SMTP_USER and SMTP_PASSWORD to server_bun/.env (Gmail: use a 16-char App Password).");
}

export const sendVerificationEmail = async (to: string, code: string): Promise<boolean> => {
  if (!transporter) {
    console.error("❌ Cannot send email: Email transporter not configured. Missing SMTP_PASSWORD in .env");
    return false;
  }

  try {
    const mailOptions = {
      from: `CarSure DZ <${SMTP_USER}>`,
      to,
      subject: "Confirmation de votre email - CarSure DZ",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9fafb;">
          <div style="background-color: white; border-radius: 8px; padding: 30px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h1 style="color: #0d9488; text-align: center; margin-bottom: 20px;">CarSure DZ</h1>
            <h2 style="color: #1f2937; margin-bottom: 20px;">Confirmation de votre email</h2>
            <p style="color: #4b5563; line-height: 1.6; margin-bottom: 20px;">
              Bonjour,
            </p>
            <p style="color: #4b5563; line-height: 1.6; margin-bottom: 30px;">
              Merci de vous être inscrit sur CarSure DZ. Veuillez utiliser le code suivant pour confirmer votre adresse email :
            </p>
            <div style="background-color: #f0fdfa; border: 2px solid #0d9488; border-radius: 8px; padding: 20px; text-align: center; margin: 30px 0;">
              <p style="font-size: 32px; font-weight: bold; color: #0d9488; letter-spacing: 8px; margin: 0; font-family: monospace;">
                ${String(code).trim()}
              </p>
            </div>
            <p style="color: #6b7280; font-size: 14px; margin-top: 30px;">
              Ce code est valide pendant 15 minutes. Si vous n'avez pas créé de compte, vous pouvez ignorer cet email.
            </p>
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
            <p style="color: #9ca3af; font-size: 12px; text-align: center; margin: 0;">
              © 2024 CarSure DZ. Tous droits réservés.
            </p>
          </div>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);
    console.log(`✅ Verification email sent to: ${to}`);
    return true;
  } catch (error: any) {
    console.error("❌ Error sending email:", error?.message || error);
    if (error?.code === "EAUTH") {
      console.error("   Authentication failed. Please check SMTP_PASSWORD in .env");
      console.error("   For Gmail, you need to use an App Password, not your regular password.");
      console.error("   Steps: Google Account > Security > 2-Step Verification > App Passwords");
    }
    return false;
  }
};
