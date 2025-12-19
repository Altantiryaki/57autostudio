// Optional: Fallback, falls du den Key/PlaceID nicht über env setzt.
// >>> HIER deine echten Werte eintragen (oder leer lassen, wenn du nur env nutzt)
const FALLBACK_GOOGLE_PLACES_API_KEY = "";
const FALLBACK_GOOGLE_PLACE_ID = "";

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
    const pathname = url.pathname;

    // 1) Reviews-Endpoint abfangen
    if (pathname === "/reviews") {
      return handleReviews(env);
    }

    // 2) Asset-Routing: /exclusive -> /exclusive.html etc.
    let pathToFile = pathname;

    // Wenn kein Punkt im Pfad, behandeln wir es als "clean URL"
    if (!pathToFile.includes(".")) {
      if (pathToFile === "/") {
        pathToFile = "/index.html";
      } else {
        pathToFile = `${pathToFile}.html`;
      }
    }

    try {
      // Versuche, die angefragte Datei aus dem Asset-Bundle zu holen
      const assetResponse = await env.ASSETS.fetch(
        new Request(url.origin + pathToFile, request)
      );

      // Wenn gefunden, zurückgeben
      if (assetResponse.status !== 404) {
        return assetResponse;
      }
    } catch (e) {
      // Ignorieren und auf Fallback gehen
      console.error("Asset fetch error:", e);
    }

    // 3) Fallback: immer index.html ausliefern (z.B. für 404 oder SPA)
    return env.ASSETS.fetch(
      new Request(url.origin + "/index.html", request)
    );
  }
};
