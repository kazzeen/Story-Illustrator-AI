function deriveFunctionsBaseUrl() {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "";
  if (!supabaseUrl) return null;
  const ref = new URL(supabaseUrl).hostname.split(".")[0];
  if (!ref) return null;
  return `https://${ref}.functions.supabase.co`;
}

async function readBody(req: AsyncIterable<unknown>) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    if (Buffer.isBuffer(chunk)) chunks.push(chunk);
    else if (typeof chunk === "string") chunks.push(Buffer.from(chunk));
    else if (chunk instanceof Uint8Array) chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export default async function handler(req: any, res: any) {
  const functionsBase = deriveFunctionsBaseUrl();
  if (!functionsBase) {
    res.status(500).json({ error: "configuration_error" });
    return;
  }

  const incoming = new URL(String(req.url ?? "/"), "http://localhost");
  const path = incoming.pathname.replace(/^\/api\/admin/, "");
  const targetUrl = `${functionsBase}/api-admin${path}${incoming.search}`;

  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (!v) continue;
    if (k.toLowerCase() === "host") continue;
    if (k.toLowerCase() === "connection") continue;
    if (k.toLowerCase() === "content-length") continue;
    if (Array.isArray(v)) headers.set(k, v.join(","));
    else headers.set(k, String(v));
  }

  const method = (req.method ?? "GET").toUpperCase();
  const body = method === "GET" || method === "HEAD" ? undefined : await readBody(req);

  const upstream = await fetch(targetUrl, { method, headers, body, redirect: "manual" });

  const setCookies = (upstream.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  for (const [k, v] of upstream.headers.entries()) {
    const key = k.toLowerCase();
    if (key === "set-cookie") continue;
    res.setHeader(k, v);
  }
  if (setCookies.length) res.setHeader("set-cookie", setCookies);

  res.status(upstream.status);
  const buf = Buffer.from(await upstream.arrayBuffer());
  res.send(buf);
}
