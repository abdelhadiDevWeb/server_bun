import { Router } from "express";
import type { Request, Response } from "express";

const router = Router();

/** Nominatim policy: identify the application. */
const USER_AGENT = "CarSureDZ-workshop-map/1.0 (contact via site admin)";

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
    // zoom=18 = building/street level; helps address match the pin (DZ/FR labels via Accept-Language).
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(String(latN))}&lon=${encodeURIComponent(String(lonN))}&zoom=18&addressdetails=1`;
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
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(q)}&limit=6`;
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
    const data = (await r.json()) as unknown[];
    return res.status(200).json({ ok: true, data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "search geocode failed";
    return res.status(500).json({ ok: false, message });
  }
});

export default router;
