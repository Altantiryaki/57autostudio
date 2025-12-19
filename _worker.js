export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(),
      });
    }

    // DEBUG: env check
    if (url.pathname === "/__env") {
      const cid = (env.GOOGLE_MAPS_CID ?? "");
      const gUrl = (env.GOOGLE_MAPS_URL ?? "");
      const hasKV = Boolean(env.REVIEWS_KV);

      return json({
        ok: true,
        hasCID: Boolean(cid && cid.trim().length),
        cidLen: cid.length,
        cidPreview: cid ? cid.slice(0, 6) + "..." + cid.slice(-6) : null,
        hasURL: Boolean(gUrl && gUrl.trim().length),
        urlLen: gUrl.length,
        hasKV
      });
    }

    // REVIEWS: cached scrape
if (url.pathname === "/reviews") {
  const cacheKey = "reviews:v2";
  const ttl = 21600;      // 6h
  const cooldown = 900;   // 15min: wenn Google 429, nicht sofort wieder versuchen

  if (!env.REVIEWS_KV) {
    return json({ ok: false, error: "Missing KV binding: REVIEWS_KV" }, 500, { "cache-control": "no-store" });
  }

  // read cached (if any)
  const cached = await env.REVIEWS_KV.get(cacheKey, "text");
  const last429 = await env.REVIEWS_KV.get("reviews:last429", "text");

  // if we have cache, serve it immediately
  if (cached) {
    // background refresh (only if not in cooldown)
    const now = Date.now();
    const last = last429 ? Number(last429) : 0;

    if (now - last > cooldown * 1000) {
      ctx.waitUntil((async () => {
        try {
          const out = await scrapeGoogleReviews(env);
          await env.REVIEWS_KV.put(cacheKey, JSON.stringify(out), { expirationTtl: ttl });
        } catch (e) {
          // mark cooldown on 429
          if (String(e?.message || e).includes(" 429")) {
            await env.REVIEWS_KV.put("reviews:last429", String(Date.now()), { expirationTtl: cooldown });
          }
        }
      })());
    }

    return new Response(cached, {
      status: 200,
      headers: {
        ...corsHeaders(),
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=0, s-maxage=600"
      }
    });
  }

  // cache empty: try fetch once (respect cooldown)
  const now = Date.now();
  const last = last429 ? Number(last429) : 0;
  if (now - last <= cooldown * 1000) {
    // return deterministic fallback (never 500)
    return json(fallbackReviews(), 200, {
      "cache-control": "public, max-age=0, s-maxage=300",
      "x-reviews-fallback": "1"
    });
  }

  try {
    const out = await scrapeGoogleReviews(env);
    const body = JSON.stringify(out);
    await env.REVIEWS_KV.put(cacheKey, body, { expirationTtl: ttl });
    return new Response(body, {
      status: 200,
      headers: {
        ...corsHeaders(),
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=0, s-maxage=600"
      }
    });
  } catch (e) {
    if (String(e?.message || e).includes(" 429")) {
      await env.REVIEWS_KV.put("reviews:last429", String(Date.now()), { expirationTtl: cooldown });
    }
    // never 500 if cache empty + blocked: return fallback JSON
    return json(fallbackReviews(), 200, {
      "cache-control": "public, max-age=0, s-maxage=300",
      "x-reviews-fallback": "1"
    });
  }
}

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type",
  };
}

function json(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      ...corsHeaders(),
      "content-type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });
}

function buildMapsUrl(env) {
  const url = (env.GOOGLE_MAPS_URL ?? "").trim();
  const cid = (env.GOOGLE_MAPS_CID ?? "").trim();

  if (url) return url + (url.includes("?") ? "&" : "?") + "hl=de";
  if (cid) return `https://www.google.com/maps?cid=${encodeURIComponent(cid)}&hl=de`;

  throw new Error("Missing env: GOOGLE_MAPS_CID or GOOGLE_MAPS_URL");
}

async function scrapeGoogleReviews(env) {
  const target = buildMapsUrl(env);

  const res = await fetch(target, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      "accept-language": "de-DE,de;q=0.9,en;q=0.8",
    },
  });

  if (!res.ok) throw new Error(`Google fetch failed: ${res.status}`);
  const html = await res.text();

  const blocks = extractAfInitDataBlocks(html);
  if (!blocks.length) throw new Error("No AF_initDataCallback blocks found (blocked/changed)");

  blocks.sort((a, b) => b.length - a.length);
  const raw = blocks[0];

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const cleaned = raw.replace(/\\x([0-9A-Fa-f]{2})/g, (_, h) =>
      String.fromCharCode(parseInt(h, 16))
    );
    parsed = JSON.parse(cleaned);
  }

  const reviews = findReviews(parsed);

  return {
    ok: true,
    updatedAt: new Date().toISOString(),
    reviews: reviews.map(r => ({
      author_name: r.author,
      rating: r.rating,
      text: r.text
    }))
  };
}

function extractAfInitDataBlocks(html) {
  const out = [];
  const re = /AF_initDataCallback\(\{[\s\S]*?data:([\s\S]*?),\s*sideChannel:[\s\S]*?\}\);/g;
  let m;
  while ((m = re.exec(html))) {
    const dataLiteral = m[1]?.trim();
    if (dataLiteral && dataLiteral.startsWith("[")) out.push(dataLiteral);
  }
  return out;
}

function findReviews(root) {
  const results = [];
  const seen = new Set();

  const walk = (node) => {
    if (!node) return;
    if (Array.isArray(node)) {
      const maybe = parseReviewTuple(node);
      if (maybe) {
        const key = maybe.author + "|" + maybe.text.slice(0, 40);
        if (!seen.has(key)) {
          seen.add(key);
          results.push(maybe);
        }
      }
      for (const x of node) walk(x);
    }
  };

  walk(root);
  return results.slice(0, 30);
}

function parseReviewTuple(arr) {
  let rating = null;
  for (const v of arr) {
    if (typeof v === "number" && v >= 1 && v <= 5) { rating = v; break; }
  }
  if (rating == null) return null;

  const strings = arr.filter(v => typeof v === "string" && v.length >= 6);
  if (!strings.length) return null;

  strings.sort((a, b) => b.length - a.length);
  const text = strings[0];

  const short = strings.slice().sort((a, b) => a.length - b.length);
  const author = short[0];

  if (!author || !text || author === text) return null;
  return { author, rating, text };
}

function fallbackReviews() {
  return {
    ok: true,
    updatedAt: new Date().toISOString(),
    reviews: [
      { author_name: "Google Bewertung", rating: 5, text: "Bewertungen werden geladen." },
      { author_name: "Hinweis", rating: 5, text: "Falls Google kurzfristig blockt, zeigen wir automatisch wieder Live-Reviews sobald verfügbar." }
    ]
  };
}
