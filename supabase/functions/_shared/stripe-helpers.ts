/** Shared Stripe checkout helpers used by the checkout edge functions. */

export function normalizeStripeSecretKey(input: string) {
  const trimmed = input.trim();
  const unquoted =
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))
      ? trimmed.slice(1, -1).trim()
      : trimmed;
  const compact = unquoted.replace(/\s+/g, "");
  const match = compact.match(/sk_(?:test|live)_[0-9a-zA-Z]+/);
  return match?.[0] ?? compact;
}

export function classifyStripeKeyPrefix(value: string) {
  if (!value) return "empty";
  if (value.startsWith("sk_test_")) return "sk_test_";
  if (value.startsWith("sk_live_")) return "sk_live_";
  if (value.startsWith("pk_test_")) return "pk_test_";
  if (value.startsWith("pk_live_")) return "pk_live_";
  if (value.startsWith("rk_test_")) return "rk_test_";
  if (value.startsWith("rk_live_")) return "rk_live_";
  if (value.startsWith("whsec_")) return "whsec_";
  if (value.startsWith("eyJ")) return "jwt_like";
  return "unknown";
}

export function buildCheckoutReturnUrls(
  req: Request,
  opts: {
    preferredBase?: string | null;
    successParam?: string;
    cancelParam?: string;
  } = {},
) {
  const { preferredBase, successParam = "checkout", cancelParam = "checkout" } = opts;

  let origin =
    req.headers.get("origin") ??
    req.headers.get("Origin") ??
    null;

  if (!origin) {
    const ref = req.headers.get("referer") ?? req.headers.get("referrer") ?? null;
    if (ref) {
      try {
        origin = new URL(ref).origin;
      } catch {
        origin = null;
      }
    }
  }

  origin =
    origin ??
    Deno.env.get("PUBLIC_SITE_URL") ??
    Deno.env.get("SITE_URL") ??
    Deno.env.get("APP_URL") ??
    null;

  if (!origin) return { ok: false as const, error: "Missing request origin" };

  const requestOrigin = origin.replace(/\/$/, "");
  let base = requestOrigin;
  if (preferredBase && typeof preferredBase === "string") {
    const trimmed = preferredBase.trim();
    if (trimmed) {
      try {
        const preferredUrl = new URL(trimmed);
        const requestUrl = new URL(requestOrigin);
        if (preferredUrl.origin === requestUrl.origin) {
          base = trimmed.replace(/\/$/, "");
        }
      } catch {
        base = requestOrigin;
      }
    }
  }

  try {
    new URL(base);
  } catch {
    return { ok: false as const, error: "Invalid request origin" };
  }

  const successUrl = `${base}/pricing?${successParam}=success&session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${base}/pricing?${cancelParam}=cancel`;
  return { ok: true as const, successUrl, cancelUrl };
}

export async function fetchStripePriceId(params: {
  stripeSecretKey: string;
  productId: string;
  type: "recurring" | "one_time";
  interval?: "month" | "year";
}) {
  const url = new URL("https://api.stripe.com/v1/prices");
  url.searchParams.set("product", params.productId);
  url.searchParams.set("active", "true");
  url.searchParams.set("limit", "20");
  url.searchParams.set("type", params.type);
  if (params.type === "recurring" && params.interval) {
    url.searchParams.set("recurring[interval]", params.interval);
  }

  const resp = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${params.stripeSecretKey}` },
  });
  const text = await resp.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  if (!resp.ok || !body || typeof body !== "object") {
    return { ok: false as const, status: resp.status, body, raw: text };
  }

  const data = (body as Record<string, unknown>).data;
  if (!Array.isArray(data)) return { ok: false as const, status: 502, body, raw: text };
  const candidates = data.filter((p) => p && typeof p === "object") as Array<Record<string, unknown>>;

  for (const price of candidates) {
    const id = typeof price.id === "string" ? price.id : null;
    const currency = typeof price.currency === "string" ? price.currency : null;
    if (params.type === "recurring") {
      const recurring = price.recurring && typeof price.recurring === "object" ? (price.recurring as Record<string, unknown>) : null;
      const interval = recurring && typeof recurring.interval === "string" ? recurring.interval : null;
      if (id && id.startsWith("price_") && currency === "usd" && interval === params.interval) {
        return { ok: true as const, priceId: id };
      }
    } else {
      if (id && id.startsWith("price_") && currency === "usd") {
        return { ok: true as const, priceId: id };
      }
    }
  }

  for (const price of candidates) {
    const id = typeof price.id === "string" ? price.id : null;
    if (id && id.startsWith("price_")) return { ok: true as const, priceId: id };
  }

  return { ok: false as const, status: 404, body: { error: "No active Stripe price found for product" } };
}

export async function createStripeCheckoutSession(params: {
  stripeSecretKey: string;
  idempotencyKey: string;
  form: URLSearchParams;
}) {
  const makeRequest = async (formData: URLSearchParams, idempotencyKey: string) => {
    const resp = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.stripeSecretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Idempotency-Key": idempotencyKey,
      },
      body: formData.toString(),
    });

    const text = await resp.text();
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }

    return { resp, text, body };
  };

  let { resp, text, body } = await makeRequest(params.form, params.idempotencyKey);

  // If the customer doesn't exist (test mode customer used with live mode key), retry without customer
  if (!resp.ok && body && typeof body === "object") {
    const error = (body as Record<string, unknown>).error;
    if (error && typeof error === "object") {
      const errorObj = error as Record<string, unknown>;
      if (errorObj.code === "resource_missing" && errorObj.param === "customer") {
        console.log("Customer not found in Stripe, retrying without customer ID...");
        const retryForm = new URLSearchParams(params.form.toString());
        retryForm.delete("customer");
        const retryResult = await makeRequest(retryForm, params.idempotencyKey + "-retry");
        resp = retryResult.resp;
        text = retryResult.text;
        body = retryResult.body;
      }
    }
  }

  if (!resp.ok) {
    const stripeError =
      body && typeof body === "object" && "error" in (body as Record<string, unknown>) && typeof (body as Record<string, unknown>).error === "object"
        ? (body as { error?: unknown }).error
        : null;
    return { ok: false as const, status: resp.status, body, raw: text, stripeError };
  }

  const url =
    body && typeof body === "object" && "url" in (body as Record<string, unknown>) && typeof (body as Record<string, unknown>).url === "string"
      ? String((body as Record<string, unknown>).url)
      : null;

  const id =
    body && typeof body === "object" && "id" in (body as Record<string, unknown>) && typeof (body as Record<string, unknown>).id === "string"
      ? String((body as Record<string, unknown>).id)
      : null;

  if (!url || !id) return { ok: false as const, status: 502, body, raw: text };
  return { ok: true as const, id, url };
}
