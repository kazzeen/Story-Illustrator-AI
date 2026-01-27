import "dotenv/config";
import process from "node:process";
import { URLSearchParams } from "node:url";

function requireEnv(name) {
  const value = (process.env[name] ?? "").trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function normalizeStripeSecretKey(input) {
  const trimmed = String(input ?? "").trim();
  const unquoted =
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))
      ? trimmed.slice(1, -1).trim()
      : trimmed;
  const compact = unquoted.replace(/\s+/g, "");
  const match = compact.match(/sk_(?:test|live)_[0-9a-zA-Z]+/);
  return match?.[0] ?? compact;
}

function normalizeUrl(input) {
  const raw = String(input ?? "").trim().replace(/\/$/, "");
  if (!raw) throw new Error("Missing URL");
  return raw;
}

function parseArgs(argv) {
  const args = new Map();
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith("--")) continue;
    const value = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : "";
    args.set(key.slice(2), value);
    if (value) i++;
  }
  return args;
}

async function stripeFetch(params) {
  const resp = await fetch(params.url, {
    method: params.method ?? "GET",
    headers: {
      Authorization: `Bearer ${params.stripeSecretKey}`,
      ...(params.contentType ? { "Content-Type": params.contentType } : null),
    },
    body: params.body ?? undefined,
  });
  const text = await resp.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { ok: resp.ok, status: resp.status, body };
}

const args = parseArgs(process.argv);
const stripeSecretKey = normalizeStripeSecretKey(requireEnv("STRIPE_SECRET_KEY"));
const supabaseUrl = normalizeUrl(process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL);
const functionUrl = `${supabaseUrl}/functions/v1/stripe-webhook`;
const endpointId = (args.get("id") || process.env.STRIPE_WEBHOOK_ENDPOINT_ID || "we_1SlJnAGhz0DaM9Dam3dzg4wR").trim();

const enabledEvents = [
  "checkout.session.completed",
  "checkout.session.expired",
  "invoice.paid",
  "invoice.payment_succeeded",
  "invoice.payment_failed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "payment_intent.payment_failed",
];

const getBefore = await stripeFetch({
  url: `https://api.stripe.com/v1/webhook_endpoints/${encodeURIComponent(endpointId)}`,
  stripeSecretKey,
});
if (!getBefore.ok) {
  throw new Error(`Failed to fetch webhook endpoint ${endpointId} (HTTP ${getBefore.status})`);
}

const form = new URLSearchParams();
form.set("url", functionUrl);
form.set("disabled", "false");
for (const ev of enabledEvents) form.append("enabled_events[]", ev);

const updated = await stripeFetch({
  url: `https://api.stripe.com/v1/webhook_endpoints/${encodeURIComponent(endpointId)}`,
  method: "POST",
  stripeSecretKey,
  contentType: "application/x-www-form-urlencoded",
  body: form.toString(),
});

if (!updated.ok) {
  const errorType = typeof updated.body === "object" && updated.body && "error" in updated.body ? updated.body.error?.type : null;
  const message = typeof updated.body === "object" && updated.body && "error" in updated.body ? updated.body.error?.message : null;
  throw new Error(`Stripe webhook update failed (HTTP ${updated.status})${errorType ? ` ${errorType}` : ""}${message ? `: ${message}` : ""}`);
}

const afterUrl = typeof updated.body === "object" && updated.body && typeof updated.body.url === "string" ? updated.body.url : null;
const afterEvents = typeof updated.body === "object" && updated.body && Array.isArray(updated.body.enabled_events) ? updated.body.enabled_events : null;
const afterDisabled = typeof updated.body === "object" && updated.body && typeof updated.body.disabled === "boolean" ? updated.body.disabled : null;

process.stdout.write(
  JSON.stringify(
    {
      ok: true,
      endpointId,
      url: afterUrl,
      disabled: afterDisabled,
      enabledEventsCount: Array.isArray(afterEvents) ? afterEvents.length : null,
    },
    null,
    2,
  ) + "\n",
);
