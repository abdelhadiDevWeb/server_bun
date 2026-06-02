import crypto from "crypto";

export type ChargilyCheckoutPayload = {
  amount: number;
  currency: "dzd";
  success_url: string;
  failure_url: string;
  webhook_endpoint: string;
  locale?: "fr" | "en" | "ar";
  description?: string;
  metadata?: Record<string, string>;
};

export type ChargilyCheckout = {
  id: string;
  checkout_url: string;
  amount: number;
  currency: string;
  status: string;
  livemode?: boolean;
};

function getSecretKey(): string {
  const key = process.env.CHARGILY_SECRET_KEY?.trim();
  if (!key) {
    throw new Error("CHARGILY_SECRET_KEY is not configured");
  }
  return key;
}

export function getChargilyApiBaseUrl(): string {
  const configured = process.env.CHARGILY_API_BASE_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");

  const secretKey = getSecretKey();
  const isLive = secretKey.startsWith("live_sk_");
  return isLive
    ? "https://pay.chargily.net/api/v2"
    : "https://pay.chargily.net/test/api/v2";
}

export function verifyChargilyWebhookSignature(
  rawBody: string | Buffer,
  signatureHeader: string | undefined
): boolean {
  if (!signatureHeader) return false;

  const payload =
    typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");

  const computed = crypto
    .createHmac("sha256", getSecretKey())
    .update(payload)
    .digest("hex");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(computed, "utf8"),
      Buffer.from(signatureHeader, "utf8")
    );
  } catch {
    return false;
  }
}

/** Chargily live API can be slow; too short a timeout blocks redirect with no URL. */
const CHARGILY_FETCH_TIMEOUT_MS = 30_000;

async function chargilyFetch(
  url: string,
  init: RequestInit
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    CHARGILY_FETCH_TIMEOUT_MS
  );
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Chargily API timeout — réessayez dans un instant");
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Reuse an open checkout instead of creating a duplicate on every Pay tap. */
export async function getChargilyCheckout(
  checkoutId: string
): Promise<ChargilyCheckout | null> {
  const id = checkoutId?.trim();
  if (!id) return null;

  const apiBase = getChargilyApiBaseUrl();
  const secretKey = getSecretKey();

  const res = await chargilyFetch(`${apiBase}/checkouts/${encodeURIComponent(id)}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      Accept: "application/json",
    },
  });

  const data = (await res.json().catch(() => null)) as
    | (ChargilyCheckout & { message?: string })
    | null;

  if (!res.ok || !data?.checkout_url) {
    return null;
  }

  const terminal = ["paid", "expired", "canceled", "cancelled"].includes(
    String(data.status || "").toLowerCase()
  );
  if (terminal) return null;

  return data;
}

export async function createChargilyCheckout(
  payload: ChargilyCheckoutPayload
): Promise<ChargilyCheckout> {
  const apiBase = getChargilyApiBaseUrl();
  const secretKey = getSecretKey();

  const res = await chargilyFetch(`${apiBase}/checkouts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = (await res.json().catch(() => null)) as
    | (ChargilyCheckout & { message?: string; error?: string })
    | null;

  if (!res.ok || !data?.checkout_url || !data?.id) {
    const msg =
      data?.message ||
      data?.error ||
      `Chargily checkout failed (${res.status})`;
    throw new Error(msg);
  }

  return data;
}

export function getFrontendBaseUrl(): string {
  const raw =
    process.env.FRONTEND_URL ||
    process.env.URLFRONT ||
    process.env.CLIENT_URL ||
    "http://localhost:3000";
  return raw.replace(/\/$/, "");
}

export function getBackendPublicUrl(): string {
  const raw =
    process.env.BACKEND_PUBLIC_URL ||
    process.env.PUBLIC_BACKEND_URL ||
    `http://localhost:${process.env.PORT || 7000}`;
  return raw.replace(/\/$/, "");
}
