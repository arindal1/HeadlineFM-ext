/**
 * server.js - HeadlineFM shared narration cache API
 *
 * Endpoints:
 *   GET  /api/narration?date=YYYY-MM-DD&cats=tech,science,...&gender=female
 *   POST /api/narration  { date, categories, gender, narration }
 *
 * Deploy free on Render.com:
 *   1. Push this backend/ folder to a GitHub repo (or the whole NewsRep repo)
 *   2. Create a new "Web Service" on render.com → connect repo
 *   3. Root directory: backend  |  Build: npm install  |  Start: node server.js
 *   4. Add env vars: MONGODB_URI, WRITE_SECRET (optional)
 */

"use strict";

// dotenv: loads .env in local dev; no-op in production if the file is absent.
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");

const narrationRoutes = require("./routes/narration");

const app = express();
const PORT = process.env.PORT || 3000;

/* - Middleware - */
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST"],
  }),
);
app.use(express.json({ limit: "25kb" }));
app.set("trust proxy", 1);

/* - Routes - */
app.use("/api/narration", narrationRoutes);

app.get("/health", (_req, res) =>
  res.json({ status: "ok", ts: new Date().toISOString() }),
);

app.use((_req, res) => res.status(404).json({ error: "Not found." }));

/* - Database + boot - */
const MONGO_URI = process.env.MONGODB_URI;
if (!MONGO_URI) {
  console.error("ERROR: MONGODB_URI environment variable is not set.");
  process.exit(1);
}

mongoose
  .connect(MONGO_URI)
  .then(() => {
    console.log("MongoDB connected");
    app.listen(PORT, () =>
      console.log(`HeadlineFM cache server running on port ${PORT}`),
    );
  })
  .catch((err) => {
    console.error("MongoDB connection failed:", err.message);
    process.exit(1);
  });
