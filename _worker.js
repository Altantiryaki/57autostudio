// Optional: Fallback, falls du den Key/PlaceID nicht über env setzt.
// >>> HIER deine echten Werte eintragen (oder leer lassen, wenn du nur env nutzt)
const FALLBACK_GOOGLE_PLACE_ID = "ChIJOWn9FC7VmUcRitgY38HREJM";

// Holt die Google Reviews über Places Details API
async function handleReviews(env) {
  const apiKey = env.GOOGLE_PLACES_API_KEY || env.GOOGLE_API_KEY || FALLBACK_GOOGLE_PLACES_API_KEY;
  const placeId = env.GOOGLE_PLACES_PLACE_ID || env.GOOGLE_PLACE_ID || FALLBACK_GOOGLE_PLACE_ID;

  if (!apiKey || !placeId) {
    // Kein Key / Place ID gesetzt -> leere Antwort (Seite bleibt sauber)
    return new Response(
      JSON.stringify({ reviews: [] }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        }
      }
    );
  }
  
const apiUrl = `https://maps.googleapis.com/maps/api/place/details/json`
  + `?place_id=${encodeURIComponent(placeId)}`
  + `&fields=rating,user_ratings_total,reviews`
  + `&reviews_sort=newest`
  + `&language=de`
  + `&reviews_no_translations=true`
  + `&key=${encodeURIComponent(apiKey)}`;

  try {
    const resp = await fetch(apiUrl);
    if (!resp.ok) {
      console.error("Google Places API error:", resp.status, resp.statusText);
      return new Response(
        JSON.stringify({ reviews: [] }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
          }
        }
      );
    }

    const data = await resp.json();

    const reviews = (data?.result?.reviews || []).map(r => ({
      author_name: r.author_name,
      rating: r.rating,
      relative_time: r.relative_time_description,
      text: r.text
    }));

    return new Response(
      JSON.stringify({ reviews }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        }
      }
    );
  } catch (err) {
    console.error("handleReviews exception:", err);
    return new Response(
      JSON.stringify({ reviews: [] }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        }
      }
    );
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // DEBUG: env check
    if (url.pathname === "/__env") {
      const cid = (env.GOOGLE_MAPS_CID ?? "");
      const gUrl = (env.GOOGLE_MAPS_URL ?? "");
      return new Response(JSON.stringify({
        ok: true,
        hasCID: Boolean(cid && cid.trim().length),
        cidLen: cid.length,
        cidPreview: cid ? cid.slice(0, 6) + "..." + cid.slice(-6) : null,
        hasURL: Boolean(gUrl && gUrl.trim().length),
        urlLen: gUrl.length
      }), { headers: { "content-type": "application/json; charset=utf-8" } });
    }

    // IMPORTANT: /reviews must be handled BEFORE assets
    if (url.pathname === "/reviews") {
      try {
        const out = await scrapeGoogleReviews(env);
        return new Response(JSON.stringify(out), {
          status: 200,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "access-control-allow-origin": "*",
            "cache-control": "public, max-age=0, s-maxage=600"
          }
        });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), {
          status: 500,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "access-control-allow-origin": "*",
            "cache-control": "no-store"
          }
        });
      }
    }

    // Everything else: Pages handles pretty URLs
    return env.ASSETS.fetch(request);
  }
};

function buildMapsUrl(env) {
  if (env.GOOGLE_MAPS_URL && String(env.GOOGLE_MAPS_URL).trim()) {
    const u = String(env.GOOGLE_MAPS_URL).trim();
    return u + (u.includes("?") ? "&" : "?") + "hl=de";
  }
  if (env.GOOGLE_MAPS_CID && String(env.GOOGLE_MAPS_CID).trim()) {
    const cid = String(env.GOOGLE_MAPS_CID).trim();
    return `https://www.google.com/maps?cid=${encodeURIComponent(cid)}&hl=de`;
  }
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
  if (!blocks.length) throw new Error("No AF_initDataCallback blocks found (Google layout changed / blocked)");

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

  // IMPORTANT: return same shape your frontend expects
  return {
    ok: true,
    updatedAt: new Date().toISOString(),
    reviews: reviews.map(r => ({
      author_name: r.author,
      rating: r.rating,
      relative_time: r.relative_time || "",
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

