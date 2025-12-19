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

    if (url.pathname === "/__env") {
      const cid = (env.GOOGLE_MAPS_CID ?? "");
      const gUrl = (env.GOOGLE_MAPS_URL ?? "");

      return new Response(JSON.stringify({
        ok: true,
        hasCID: Boolean(cid && cid.trim().length),
        cidLen: cid.length,
        cidPreview: cid
          ? cid.slice(0, 6) + "..." + cid.slice(-6)
          : null,
        hasURL: Boolean(gUrl && gUrl.trim().length),
        urlLen: gUrl.length,
      }), {
        headers: { "content-type": "application/json; charset=utf-8" }
      });
    }

    // alles andere normal über Pages
    return env.ASSETS.fetch(request);
  },
};

function json(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, OPTIONS",
      "access-control-allow-headers": "content-type",
      ...extraHeaders,
    },
  });
}

async function scrapeGoogleReviews(env) {
  const target = buildMapsUrl(env);
  const res = await fetch(target, {
    headers: {
      // mimic a normal browser a bit
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      "accept-language": "de-DE,de;q=0.9,en;q=0.8",
    },
  });

  if (!res.ok) throw new Error(`Google fetch failed: ${res.status}`);
  const html = await res.text();

  // Extract AF_initDataCallback blocks (Google embeds big JS arrays there)
  const blocks = extractAfInitDataBlocks(html);
  if (!blocks.length) throw new Error("No AF_initDataCallback blocks found");

  // Heuristic: pick the biggest block and try to locate reviews inside
  blocks.sort((a, b) => b.length - a.length);
  const raw = blocks[0];

  // raw is a JS array literal (usually valid JSON). Parse it.
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // fallback: sometimes it contains \x.. or weird escapes; try to clean minimal
    const cleaned = raw
      .replace(/\\x([0-9A-Fa-f]{2})/g, (_, h) =>
        String.fromCharCode(parseInt(h, 16))
      );
    parsed = JSON.parse(cleaned);
  }

  const reviews = findReviews(parsed);

  return {
    ok: true,
    source: "google-maps-scrape",
    updatedAt: new Date().toISOString(),
    count: reviews.length,
    reviews,
  };
}

function buildMapsUrl(env) {
  if (env.GOOGLE_MAPS_URL) {
    return env.GOOGLE_MAPS_URL + (env.GOOGLE_MAPS_URL.includes("?") ? "&" : "?") + "hl=de";
  }
  if (env.GOOGLE_MAPS_CID) {
    return `https://www.google.com/maps?cid=${encodeURIComponent(
      env.GOOGLE_MAPS_CID
    )}&hl=de`;
  }
  throw new Error("Missing env: GOOGLE_MAPS_CID or GOOGLE_MAPS_URL");
}

function extractAfInitDataBlocks(html) {
  // Matches: AF_initDataCallback({key: 'ds:1', data: [...], sideChannel: {...}});
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
  // We walk the nested arrays and look for review-like tuples.
  // Google review entries typically contain:
  // - author name (string)
  // - rating (number 1..5)
  // - text (string)
  // - time (string or timestamp)
  const results = [];

  const seen = new Set();
  const walk = (node) => {
    if (!node) return;
    if (Array.isArray(node)) {
      // Try to interpret as review record
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

  // Keep a sane max
  return results.slice(0, 30);
}

function parseReviewTuple(arr) {
  // Very defensive heuristic.
  // We look for: [ ..., [authorName, ...], ..., rating, ..., text, ...]
  // This changes often; we just hunt for plausible fields.
  let author = null;
  let rating = null;
  let text = null;

  // find rating
  for (const v of arr) {
    if (typeof v === "number" && v >= 1 && v <= 5) {
      rating = v;
      break;
    }
  }
  if (rating == null) return null;

  // find longest text-ish string
  const strings = arr.filter((v) => typeof v === "string" && v.length >= 8);
  if (!strings.length) return null;

  // text usually longer than author
  strings.sort((a, b) => b.length - a.length);
  text = strings[0];

  // author: shortest reasonable string
  const short = strings.slice().sort((a, b) => a.length - b.length);
  author = short[0];

  // prevent false positives: author shouldn't be same as text
  if (!author || !text || author === text) return null;

  return {
    author,
    rating,
    text,
  };
}
