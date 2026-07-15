const express = require("express");
const rateLimit = require("express-rate-limit");
const Narration = require("../models/Narration");

const router = express.Router();

/* -- Rate limiters ---------------------------------------------------------- */

// GET is cheap (DB read) — allow frequent polling
const readLimiter = rateLimit({
  windowMs: 60_000, // 1 minute
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, slow down." },
});

// POST triggers a Gemini call from the client — limit tightly
const writeLimiter = rateLimit({
  windowMs: 60_000, // 1 minute
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Write rate limit exceeded." },
});

/* -- Helpers ---------------------------------------------------------------- */

/**
 * Normalise + validate raw comma-separated category IDs into a sorted key.
 * Gender is NOT part of this key — it is handled separately.
 */
function normaliseCatsKey(rawCats) {
  if (!rawCats || typeof rawCats !== "string") return null;
  const cats = rawCats
    .split(",")
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean);
  if (cats.length === 0 || cats.length > 10) return null;
  cats.sort();
  return cats.join(",");
}

/** Validate gender string — defaults to 'female' for unknown values. */
function normaliseGender(raw) {
  return raw === "male" ? "male" : "female";
}

/**
 * Composite cache key used in MongoDB: "sortedCats_gender"
 * e.g. "finance,science,technology_female"
 * Built server-side so the client never needs to know the key format.
 */
function buildCacheKey(catsKey, gender) {
  return `${catsKey}_${gender}`;
}

/** UTC date string "YYYY-MM-DD" */
function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

/* -- GET /api/narration ---------------------------------------------------
   Query params:
     date     (optional) YYYY-MM-DD  — defaults to today UTC
     cats     (required) comma-separated category IDs
     gender   (optional) 'female' | 'male'  — defaults to 'female'
   Response 200: { narration, date, categoriesKey, gender, cachedAt }
   Response 404: { error: 'not_cached' }
   Response 400: bad params
-------------------------------------------------------------------------- */
router.get("/", readLimiter, async (req, res) => {
  const date = req.query.date || todayUTC();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res
      .status(400)
      .json({ error: "Invalid date format. Use YYYY-MM-DD." });
  }

  const catsKey = normaliseCatsKey(req.query.cats);
  if (!catsKey) {
    return res
      .status(400)
      .json({
        error: "cats param is required (comma-separated category IDs, max 10).",
      });
  }

  const gender = normaliseGender(req.query.gender);
  const categoriesKey = buildCacheKey(catsKey, gender);

  try {
    const doc = await Narration.findOne({ date, categoriesKey })
      .select("narration createdAt")
      .lean();
    if (!doc) return res.status(404).json({ error: "not_cached" });

    return res.json({
      narration: doc.narration,
      date,
      categoriesKey,
      gender,
      cachedAt: doc.createdAt,
    });
  } catch (err) {
    console.error("[GET /narration]", err.message);
    return res.status(500).json({ error: "Database error." });
  }
});

/* -- POST /api/narration --------------------------------------------------
   Body (JSON):
     date          YYYY-MM-DD
     categories    string — comma-separated category IDs (no gender suffix)
     gender        'female' | 'male'
     narration     string — the full Gemini narration text
   Headers:
    x-headline-secret  (if WRITE_SECRET env var is set)
-------------------------------------------------------------------------- */
router.post("/", writeLimiter, async (req, res) => {
  const secret = process.env.WRITE_SECRET;
  if (secret && req.headers["x-headline-secret"] !== secret) {
    return res.status(403).json({ error: "Forbidden." });
  }

  const { date, categories, gender: rawGender, narration } = req.body;

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: "date must be YYYY-MM-DD." });
  }

  const catsKey = normaliseCatsKey(categories);
  if (!catsKey) {
    return res
      .status(400)
      .json({ error: "categories is required (comma-separated, max 10)." });
  }

  if (
    !narration ||
    typeof narration !== "string" ||
    narration.trim().length < 50
  ) {
    return res
      .status(400)
      .json({ error: "narration must be a non-empty string." });
  }

  if (Buffer.byteLength(narration, "utf8") > 20_480) {
    return res.status(400).json({ error: "narration payload too large." });
  }

  const gender = normaliseGender(rawGender);
  const categoriesKey = buildCacheKey(catsKey, gender);
  // categoryCount derived from the categories key, not the composite key
  const categoryCount = catsKey.split(",").length;

  try {
    await Narration.findOneAndUpdate(
      { date, categoriesKey },
      {
        $setOnInsert: {
          narration: narration.trim(),
          categoryCount,
        },
      },
      { upsert: true, new: false },
    );
    return res.status(201).json({ ok: true, date, categoriesKey });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(200).json({ ok: true, note: "already_cached" });
    }
    console.error("[POST /narration]", err.message);
    return res.status(500).json({ error: "Database error." });
  }
});

module.exports = router;