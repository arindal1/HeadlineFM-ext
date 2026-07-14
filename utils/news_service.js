/**
 * news-service.js
 * Fetches top headlines and topic-specific articles from NewsAPI.org.
 * Free Developer tier: 100 req/day · https://newsapi.org
 */

const BASE_HEADLINES = "https://newsapi.org/v2/top-headlines";
const BASE_EVERYTHING = "https://newsapi.org/v2/everything";
const PAGE_SIZE = 5;

/**
 * Category config map.
 * type "headlines" → /top-headlines?category=…
 * type "everything" → /everything?q=…&sortBy=publishedAt
 */
export const CATEGORIES = [
  {
    id: "technology",
    label: "TECH",
    icon: "💻",
    type: "headlines",
    param: "technology",
    important: true,
  },
  {
    id: "science",
    label: "SCIENCE",
    icon: "🔬",
    type: "headlines",
    param: "science",
  },
  {
    id: "business",
    label: "BIZ",
    icon: "📊",
    type: "headlines",
    param: "business",
  },
  {
    id: "entertainment",
    label: "ENT",
    icon: "🎬",
    type: "headlines",
    param: "entertainment",
  },
  {
    id: "general",
    label: "GENERAL",
    icon: "📰",
    type: "headlines",
    param: "general",
  },
  {
    id: "sports-football",
    label: "FOOTB",
    icon: "⚽",
    type: "everything",
    param:
      'football soccer "Premier League" OR "La Liga" OR "Champions League"',
  },
  {
    id: "sports-f1",
    label: "F1",
    icon: "🏎️",
    type: "everything",
    param: '"Formula 1" OR "F1 Grand Prix" OR "Formula One"',
  },
  {
    id: "sports-ufc",
    label: "UFC",
    icon: "🥊",
    type: "everything",
    param: 'UFC MMA "mixed martial arts" fight',
  },
  {
    id: "politics",
    label: "POLITICS",
    icon: "🏛️",
    type: "everything",
    param: "politics government election parliament senate",
  },
  {
    id: "finance",
    label: "FINANCE",
    icon: "💰",
    type: "everything",
    param: 'finance "stock market" economy investing "interest rate"',
  },
];

/**
 * Fetch articles for a single category.
 * @param {object} cat   – entry from CATEGORIES
 * @param {string} apiKey
 * @returns {{ category: string, articles: Array }}
 */
export async function fetchCategory(cat, apiKey) {
  let url;
  const today = new Date().toISOString().slice(0, 10);

  if (cat.type === "headlines") {
    url = `${BASE_HEADLINES}?category=${encodeURIComponent(cat.param)}&language=en&pageSize=${PAGE_SIZE}&apiKey=${apiKey}`;
  } else {
    url = `${BASE_EVERYTHING}?q=${encodeURIComponent(cat.param)}&language=en&sortBy=publishedAt&pageSize=${PAGE_SIZE}&from=${today}&apiKey=${apiKey}`;
  }

  const resp = await fetch(url);
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.message || `HTTP ${resp.status}`);
  }

  const data = await resp.json();
  if (data.status !== "ok") throw new Error(data.message || "NewsAPI error");

  // Normalise articles - keep only the fields we need
  const articles = (data.articles || [])
    .filter((a) => a.title && a.title !== "[Removed]")
    .slice(0, PAGE_SIZE)
    .map((a) => ({
      title: a.title,
      description: a.description || "",
      source: a.source?.name || "",
    }));

  return { category: cat.label, id: cat.id, articles };
}

/**
 * Fetch all selected categories in parallel.
 * Uses Promise.allSettled so one failed category doesn't kill the rest.
 * @param {string[]} categoryIds
 * @param {string}   apiKey
 * @returns {Array<{ status, value?, reason? }>}
 */
export async function fetchAllNews(categoryIds, apiKey) {
  const targets = CATEGORIES.filter((c) => categoryIds.includes(c.id));
  return Promise.allSettled(targets.map((c) => fetchCategory(c, apiKey)));
}

/**
 * Format settled results into a plain-text block suitable for the Gemini prompt.
 */
export function formatNewsForPrompt(settledResults) {
  const sections = [];

  for (const result of settledResults) {
    if (result.status !== "fulfilled") continue;
    const { category, articles } = result.value;
    if (!articles.length) continue;

    const lines = articles.map((a) => {
      const desc = a.description ? ` - ${a.description.slice(0, 120)}` : "";
      return `  • ${a.title}${desc}`;
    });
    sections.push(`[${category}]\n${lines.join("\n")}`);
  }

  return sections.join("\n\n");
}
