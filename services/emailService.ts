import "dotenv/config";

const normalizeEnv = (value: string | undefined): string =>
  String(value || "")
    .trim()
    .replace(/^['"]+|['"]+$/g, "");

const RESEND_API_KEY = normalizeEnv(process.env.RESEND_API_KEY);
const RESEND_FROM = normalizeEnv(process.env.RESEND_FROM) || "CarSure DZ <onboarding@resend.dev>";

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

if (RESEND_API_KEY) {
  console.log("✅ Email provider set to Resend.");
} else {
  console.warn("⚠️ RESEND_API_KEY is not configured. Email sending is disabled.");
}

export const sendVerificationEmail = async (to: string, code: string): Promise<boolean> => {
  const normalizedTo = normalizeEnv(to).toLowerCase();
  if (!normalizedTo) {
    console.error("❌ Cannot send email: recipient is empty");
    return false;
  }
  console.log("📧 Sending verification email with Resend...");
  return sendWithResend(
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
  console.log("📧 Sending password reset email with Resend...");
  return sendWithResend(
    normalizedTo,
    "Réinitialisation du mot de passe - CarSure DZ",
    passwordResetHtmlTemplate(code)
  );
};
