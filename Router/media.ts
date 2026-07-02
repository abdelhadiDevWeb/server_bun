import { Router } from "express";
import type { Request, Response } from "express";
import path from "path";
import { existsSync, mkdirSync } from "fs";
import { createHash } from "crypto";
import sharp from "sharp";

const router = Router();

const uploadsRoot = path.resolve(process.cwd(), "uploads");
const cacheRoot = path.join(uploadsRoot, "_cache");

const ALLOWED_PREFIXES = [
  "/uploads/images/",
  "/uploads/users_images/",
  "/uploads/rdv_images/",
];

function isAllowedImagePath(relativeUrlPath: string): boolean {
  const normalized = relativeUrlPath.replace(/\\/g, "/");
  if (!ALLOWED_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return false;
  }
  if (normalized.includes("..")) return false;
  return true;
}

function resolveSourceFile(relativeUrlPath: string): string | null {
  const normalized = relativeUrlPath.replace(/\\/g, "/");
  if (!isAllowedImagePath(normalized)) return null;
  const diskPath = path.resolve(uploadsRoot, normalized.replace(/^\/uploads\//, ""));
  if (!diskPath.startsWith(uploadsRoot)) return null;
  if (!existsSync(diskPath)) return null;
  return diskPath;
}

function cacheFilePath(sourcePath: string, width: number, quality: number): string {
  const hash = createHash("sha1")
    .update(`${sourcePath}|w${width}|q${quality}`)
    .digest("hex");
  return path.join(cacheRoot, `${hash}.webp`);
}

router.get("/image", async (req: Request, res: Response) => {
  try {
    const rawPath = String(req.query.path ?? "").trim();
    if (!rawPath) {
      return res.status(400).json({ ok: false, message: "path required" });
    }

    const width = Math.min(2000, Math.max(64, Number(req.query.w) || 960));
    const quality = Math.min(95, Math.max(40, Number(req.query.q) || 75));

    const sourcePath = resolveSourceFile(rawPath);
    if (!sourcePath) {
      return res.status(404).json({ ok: false, message: "image not found" });
    }

    if (!existsSync(cacheRoot)) {
      mkdirSync(cacheRoot, { recursive: true });
    }

    const cached = cacheFilePath(sourcePath, width, quality);
    if (!existsSync(cached)) {
      await sharp(sourcePath)
        .rotate()
        .resize({ width, withoutEnlargement: true })
        .webp({ quality })
        .toFile(cached);
    }

    const cacheName = path.basename(cached);
    return res.redirect(302, `/uploads/_cache/${cacheName}`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "image resize failed";
    return res.status(500).json({ ok: false, message });
  }
});

export default router;
