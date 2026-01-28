import fetch from "node-fetch";

const baseUrl = process.env.ADMIN_BASE_URL ?? "http://localhost:5173";
const cookie = process.env.ADMIN_COOKIE ?? "";
const csrf = process.env.ADMIN_CSRF ?? "";
const concurrency = Number(process.env.CONCURRENCY ?? "10");
const requests = Number(process.env.REQUESTS ?? "100");

if (!cookie || !csrf) {
  console.error("Missing ADMIN_COOKIE or ADMIN_CSRF env vars.");
  process.exit(1);
}

async function hit(i) {
  const page = (i % 10) + 1;
  const url = `${baseUrl}/api/admin/users?page=${page}&pageSize=20&sortBy=created_at&sortDir=desc`;
  const resp = await fetch(url, {
    method: "GET",
    headers: {
      cookie,
      "x-csrf-token": csrf,
    },
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`HTTP_${resp.status} ${text}`);
  }
  await resp.arrayBuffer();
}

async function run() {
  const startedAt = Date.now();
  let idx = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const i = idx;
      idx += 1;
      if (i >= requests) return;
      await hit(i);
    }
  });
  await Promise.all(workers);
  const elapsedMs = Date.now() - startedAt;
  const rps = (requests / (elapsedMs / 1000)).toFixed(2);
  console.log(JSON.stringify({ ok: true, baseUrl, requests, concurrency, elapsedMs, rps }));
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});

