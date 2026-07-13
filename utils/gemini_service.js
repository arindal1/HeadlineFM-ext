/**
 * gemini-service.js
 * Uses Google Gemini 1.5 Flash (free tier) to transform raw news
 * into an entertaining, personality-rich narration script.
 * Free tier: 15 RPM · 1M tokens/day
 * Docs: https://ai.google.dev/
 */

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';

