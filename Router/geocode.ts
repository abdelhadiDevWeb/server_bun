import { Router } from "express";
import type { Request, Response } from "express";

const router = Router();

/** Nominatim policy: identify the application. */
const USER_AGENT = "CarSureDZ-workshop-map/1.0 (contact via site admin)";

/** Algeria bounding box for Nominatim: lon_min, lat_max, lon_max, lat_min */
const ALGERIA_VIEWBOX = "-8.684399,37.118381,11.999506,19.057441";

const ALGERIA_BOUNDS = {
  south: 19.057441,
  north: 37.118381,
  west: -8.684399,
  east: 11.999506,
};

const ALGERIA_CENTER = "36.7538,3.0588";
const ALGERIA_RADIUS = "800000";

type GoogleAddressComponent = {
  long_name: string;
  short_name: string;
  types: string[];
};

function getGoogleMapsKey(): string | null {
  const key =
    process.env.API_MAP ||
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  return key?.trim() || null;
}

function cleanAdminLabel(value: string, prefixes: RegExp[]): string {
  let out = value.trim();
  for (const prefix of prefixes) {
    out = out.replace(prefix, "").trim();
  }
  return out;
}

function parseAlgeriaAdminFromGoogleComponents(
  components: GoogleAddressComponent[] | undefined,
): { commune: string; wilaya: string; daira: string } {
  if (!components?.length) {
    return { commune: "", wilaya: "", daira: "" };
  }
  const get = (...types: string[]): string => {
    for (const type of types) {
      const match = components.find((c) => c.types.includes(type));
      if (match?.long_name) return match.long_name;
    }
    return "";
  };
  const commune = cleanAdminLabel(
    get(
      "sublocality",
      "sublocality_level_1",
      "neighborhood",
      "locality",
      "administrative_area_level_3",
      "postal_town",
    ),
    [/^Commune de /i, /^Commune d['’]/i],
  );
  const wilaya = cleanAdminLabel(get("administrative_area_level_1"), [
    /^Wilaya d['’]/i,
    /^Wilaya de /i,
    /^Province of /i,
    /^Province /i,
  ]);
  const daira = cleanAdminLabel(get("administrative_area_level_2"), [
    /^Daira d['’]/i,
    /^Daïra d['’]/i,
    /^Daira de /i,
    /^Daïra de /i,
  ]);
  return { commune, wilaya, daira };
}

function resolvedPlaceFromGoogle(
  lat: number,
  lng: number,
  formattedAddress: string,
  placeId: string | null,
  components?: GoogleAddressComponent[],
) {
  if (!isInAlgeriaBounds(lat, lng)) return null;
  const admin = parseAlgeriaAdminFromGoogleComponents(components);
  return {
    lat,
    lng,
    formattedAddress,
    placeId,
    commune: admin.commune,
    wilaya: admin.wilaya,
    daira: admin.daira,
  };
}

function isInAlgeriaBounds(lat: number, lon: number): boolean {
  return (
    lat >= ALGERIA_BOUNDS.south &&
    lat <= ALGERIA_BOUNDS.north &&
    lon >= ALGERIA_BOUNDS.west &&
    lon <= ALGERIA_BOUNDS.east
  );
}

function isAlgeriaNominatimResult(data: Record<string, unknown>): boolean {
  const lat = Number(data.lat);
  const lon = Number(data.lon);
  if (Number.isFinite(lat) && Number.isFinite(lon) && !isInAlgeriaBounds(lat, lon)) {
    return false;
  }

  const address = data.address as Record<string, string> | undefined;
  const code = String(address?.country_code ?? data.country_code ?? "").toLowerCase();
  if (code && code !== "dz") return false;
  if (code === "dz") return true;

  const displayName = String(data.display_name ?? "").toLowerCase();
  const foreignHints = [
    ", france",
    ", tunisia",
    ", tunisie",
    ", morocco",
    ", maroc",
    ", libya",
    ", libye",
    ", spain",
    ", espagne",
  ];
  if (foreignHints.some((hint) => displayName.includes(hint))) return false;
  if (
    displayName.includes("algérie") ||
    displayName.includes("algeria") ||
    displayName.includes("الجزائر")
  ) {
    return true;
  }

  const country = String(address?.country ?? "").toLowerCase();
  if (country === "algérie" || country === "algeria" || country === "الجزائر") {
    return true;
  }
  if (country && country !== "algérie" && country !== "algeria" && country !== "الجزائر") {
    return false;
  }

  return Number.isFinite(lat) && Number.isFinite(lon);
}

router.get("/reverse", async (req: Request, res: Response) => {
  try {
    const lat = req.query.lat;
    const lon = req.query.lon;
    if (lat == null || lon == null) {
      return res.status(400).json({ ok: false, message: "lat and lon required" });
    }
    const latN = Number(lat);
    const lonN = Number(lon);
    if (!Number.isFinite(latN) || !Number.isFinite(lonN) || latN < -90 || latN > 90 || lonN < -180 || lonN > 180) {
      return res.status(400).json({ ok: false, message: "invalid coordinates" });
    }
    // zoom=16 = neighbourhood / commune level for Algeria admin labels
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(String(latN))}&lon=${encodeURIComponent(String(lonN))}&zoom=16&addressdetails=1`;
    const r = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
        "Accept-Language": "fr,ar,en",
      },
    });
    if (!r.ok) {
      return res.status(502).json({ ok: false, message: `geocoder HTTP ${r.status}` });
    }
    const data = (await r.json()) as Record<string, unknown>;
    if (!isAlgeriaNominatimResult(data)) {
      return res.status(400).json({
        ok: false,
        message: "Emplacement hors Algérie. Veuillez choisir un point en Algérie.",
      });
    }
    return res.status(200).json({ ok: true, data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "reverse geocode failed";
    return res.status(500).json({ ok: false, message });
  }
});

router.get("/search", async (req: Request, res: Response) => {
  try {
    const q = String(req.query.q ?? "").trim();
    if (q.length < 2) {
      return res.status(400).json({ ok: false, message: "q required (min 2 chars)" });
    }
    if (q.length > 200) {
      return res.status(400).json({ ok: false, message: "query too long" });
    }

    const lower = q.toLowerCase();
    const algeriaQuery =
      lower.includes("algérie") || lower.includes("algeria") || lower.includes("الجزائر")
        ? q
        : `${q}, Algérie`;

    const url =
      `https://nominatim.openstreetmap.org/search?format=jsonv2` +
      `&q=${encodeURIComponent(algeriaQuery)}` +
      `&limit=12` +
      `&countrycodes=dz` +
      `&addressdetails=1` +
      `&dedupe=1`;

    const r = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
        "Accept-Language": "fr,ar,en",
      },
    });
    if (!r.ok) {
      return res.status(502).json({ ok: false, message: `geocoder HTTP ${r.status}` });
    }
    const raw = (await r.json()) as Record<string, unknown>[];
    const seen = new Set<string>();
    const data = raw
      .filter((row) => isAlgeriaNominatimResult(row))
      .filter((row) => {
        const key = `${row.lat},${row.lon}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => Number(b.importance ?? 0) - Number(a.importance ?? 0))
      .slice(0, 8);
    return res.status(200).json({ ok: true, data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "search geocode failed";
    return res.status(500).json({ ok: false, message });
  }
});

/** Google Places autocomplete — Algeria only (same config as web workshop register). */
router.get("/places/autocomplete", async (req: Request, res: Response) => {
  try {
    const key = getGoogleMapsKey();
    const q = String(req.query.q ?? "").trim();
    if (q.length < 2) {
      return res.status(400).json({ ok: false, message: "q required (min 2 chars)" });
    }
    if (q.length > 200) {
      return res.status(400).json({ ok: false, message: "query too long" });
    }
    if (!key) {
      return res.status(503).json({ ok: false, message: "Google Maps API key not configured on server" });
    }

    const url = new URL("https://maps.googleapis.com/maps/api/place/autocomplete/json");
    url.searchParams.set("input", q);
    url.searchParams.set("key", key);
    url.searchParams.set("components", "country:dz");
    url.searchParams.set("language", "fr");
    url.searchParams.set("location", ALGERIA_CENTER);
    url.searchParams.set("radius", ALGERIA_RADIUS);

    const r = await fetch(url.toString());
    const json = (await r.json()) as {
      status?: string;
      error_message?: string;
      predictions?: {
        place_id: string;
        description: string;
        structured_formatting?: { main_text?: string; secondary_text?: string };
      }[];
    };

    if (json.status !== "OK" && json.status !== "ZERO_RESULTS") {
      return res.status(502).json({
        ok: false,
        message: json.error_message || `Google Places HTTP ${json.status}`,
      });
    }

    const data = (json.predictions ?? []).map((p) => ({
      placeId: p.place_id,
      description: p.description,
      label: p.structured_formatting?.main_text
        ? [p.structured_formatting.main_text, p.structured_formatting.secondary_text]
            .filter(Boolean)
            .join(", ")
        : p.description,
    }));

    return res.status(200).json({ ok: true, data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "places autocomplete failed";
    return res.status(500).json({ ok: false, message });
  }
});

/** Google Place Details — coordinates + Algeria admin fields. */
router.get("/places/details", async (req: Request, res: Response) => {
  try {
    const key = getGoogleMapsKey();
    const placeId = String(req.query.place_id ?? "").trim();
    if (!placeId) {
      return res.status(400).json({ ok: false, message: "place_id required" });
    }
    if (!key) {
      return res.status(503).json({ ok: false, message: "Google Maps API key not configured on server" });
    }

    const url = new URL("https://maps.googleapis.com/maps/api/place/details/json");
    url.searchParams.set("place_id", placeId);
    url.searchParams.set("key", key);
    url.searchParams.set("language", "fr");
    url.searchParams.set(
      "fields",
      "formatted_address,geometry,address_components,place_id,name",
    );

    const r = await fetch(url.toString());
    const json = (await r.json()) as {
      status?: string;
      error_message?: string;
      result?: {
        formatted_address?: string;
        place_id?: string;
        name?: string;
        geometry?: { location?: { lat?: number; lng?: number } };
        address_components?: GoogleAddressComponent[];
      };
    };

    if (json.status !== "OK" || !json.result?.geometry?.location) {
      return res.status(502).json({
        ok: false,
        message: json.error_message || `Google Place Details ${json.status}`,
      });
    }

    const lat = Number(json.result.geometry.location.lat);
    const lng = Number(json.result.geometry.location.lng);
    const formattedAddress =
      json.result.formatted_address ||
      (json.result.name ? `${json.result.name}, Algérie` : "");

    const data = resolvedPlaceFromGoogle(
      lat,
      lng,
      formattedAddress,
      json.result.place_id ?? placeId,
      json.result.address_components,
    );

    if (!data) {
      return res.status(400).json({
        ok: false,
        message: "Emplacement hors Algérie. Veuillez choisir un point en Algérie.",
      });
    }

    return res.status(200).json({ ok: true, data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "place details failed";
    return res.status(500).json({ ok: false, message });
  }
});

/** Google reverse geocode — GPS → address + Algeria admin fields. */
router.get("/google/reverse", async (req: Request, res: Response) => {
  try {
    const key = getGoogleMapsKey();
    const lat = req.query.lat;
    const lon = req.query.lon;
    if (lat == null || lon == null) {
      return res.status(400).json({ ok: false, message: "lat and lon required" });
    }
    const latN = Number(lat);
    const lonN = Number(lon);
    if (
      !Number.isFinite(latN) ||
      !Number.isFinite(lonN) ||
      latN < -90 ||
      latN > 90 ||
      lonN < -180 ||
      lonN > 180
    ) {
      return res.status(400).json({ ok: false, message: "invalid coordinates" });
    }
    if (!isInAlgeriaBounds(latN, lonN)) {
      return res.status(400).json({
        ok: false,
        message: "Emplacement hors Algérie. Veuillez choisir un point en Algérie.",
      });
    }
    if (!key) {
      return res.status(503).json({ ok: false, message: "Google Maps API key not configured on server" });
    }

    const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    url.searchParams.set("latlng", `${latN},${lonN}`);
    url.searchParams.set("key", key);
    url.searchParams.set("language", "fr");
    url.searchParams.set(
      "result_type",
      "street_address|route|locality|sublocality|administrative_area_level_2|administrative_area_level_1",
    );

    const r = await fetch(url.toString());
    const json = (await r.json()) as {
      status?: string;
      error_message?: string;
      results?: {
        formatted_address?: string;
        place_id?: string;
        address_components?: GoogleAddressComponent[];
      }[];
    };

    if (json.status !== "OK" || !json.results?.length) {
      return res.status(502).json({
        ok: false,
        message: json.error_message || `Google Geocode ${json.status}`,
      });
    }

    const hit =
      json.results.find((row) =>
        row.address_components?.some(
          (c) => c.types.includes("country") && c.short_name === "DZ",
        ),
      ) ?? json.results[0];

    const data = resolvedPlaceFromGoogle(
      latN,
      lonN,
      hit.formatted_address || "",
      hit.place_id ?? null,
      hit.address_components,
    );

    if (!data) {
      return res.status(400).json({
        ok: false,
        message: "Emplacement hors Algérie. Veuillez choisir un point en Algérie.",
      });
    }

    return res.status(200).json({ ok: true, data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "google reverse geocode failed";
    return res.status(500).json({ ok: false, message });
  }
});

export default router;
