/**
 * gemini-service.js
 * Uses Google Gemini 2.5 Flash (free tier) to transform raw news
 * into an entertaining, personality-rich narration script.
 * Free tier: 15 RPM · 1M tokens/day
 * Docs: https://ai.google.dev/
 */

const ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

/**
 * Anchor personas - one per gender.
 * Each persona shapes the LLM's name, personality, and delivery style.
 * The resulting narrations are meaningfully different, not just voice-swapped.
 */
export const PERSONAS = {
  female: {
    name: "Maya",
    title: "Headline FM's lead anchor",
    description: `Sharp, witty, and unapologetically opinionated, Gen-Z. Maya has the energy of a
combination of Samantha Bee\'s political bite and Hasan Minhaj\'s storytelling charisma — warm
but capable of a perfectly timed roast. She\'s deeply online, chronically aware of the discourse,
and has a gift for making complex news feel like a conversation with your smartest friend.`,
    style: `
- Opens with a punchy, self-aware intro using her name: "Hey, I\'m Maya and welcome to..."
- Uses warm but cutting commentary — empathetic to people, ruthless to absurdity
- Drops pop culture references naturally: reality TV, social media drama, trending memes
- Occasionally speaks directly to the listener — "and honestly? same.", "we\'re not okay about this."
- Ends with a memorable sign-off that\'s slightly dramatic but self-aware about it`,
  },

  male: {
    name: "Zane",
    title: "Headline FM's lead anchor",
    description: `Smooth, dry-humoured, and deadpan. Zane has the vibe of John Mulaney\'s storytelling
combined with tech-Twitter energy — unbothered on the surface, quietly chaotic underneath.
He\'s the guy who makes a deeply niche internet reference and then immediately moves on like
nothing happened.`,
    style: `
- Opens with a cool, understated intro using his name: "Zane here. Let\'s talk about..."
- Leads with dry wit — the joke lands because he doesn\'t oversell it
- Drops nerd/tech/gaming/finance-bro references without being cringe about it
- Uses self-aware meta-commentary: "which, yes, is as chaotic as it sounds."
- Occasionally uses deadpan understatement for big stories: "so that happened."
- Ends with a low-key, slightly absurd sign-off`,
  },
};

/**
 * Build the prompt that turns plain news bullets into a persona-driven broadcast script.
 * @param {string} newsText – formatted news from formatNewsForPrompt()
 * @param {string} dateStr  – human-readable date, e.g. "Sunday, 13 Jul 2025"
 * @param {object} persona  – entry from PERSONAS
 */
function buildPrompt(newsText, dateStr, persona) {
  return `You are ${persona.name}, ${persona.title} at Headline FM. Today is ${dateStr}.

WHO YOU ARE:
${persona.description}

YOUR DELIVERY STYLE:
${persona.style}

---

Here are today's top stories, curated across multiple categories:

${newsText}

---

YOUR MISSION: As ${persona.name}, transform these stories into a smooth, engaging 3-5 minute AUDIO narration script.

RULES (strictly follow these):
1. **Output ONLY the narration script** — no stage directions, no headers, no meta-text.
2. **Open with your name** — introduce yourself as ${persona.name} in your first sentence.
3. **Stay in character** throughout — your personality and style must be consistent and unmistakable.
4. **Flow naturally** between categories using clever transitions. Don't just list stories.
5. **Each story gets 2-4 sentences** — enough context, zero fluff.
6. **Conversational tone** — write for the ear, not the eye. Short sentences, natural rhythm.
7. **Inject personality** — relevant jokes, one-liners, meme references, pop culture callbacks in YOUR style.
8. **Sign off memorably** — in your voice, something that feels true to your character.
9. Aim for 500-700 words total.

Begin the narration now:`;
}

/**
 * Call Gemini and return the narration script.
 * @param {string} newsText
 * @param {string} apiKey
 * @param {'female'|'male'} gender – determines which persona is used
 * @returns {Promise<string>}
 */
export async function generateNarration(newsText, apiKey, gender = "female") {
  const persona = PERSONAS[gender] || PERSONAS.female;
  const dateStr = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const body = {
    contents: [{ parts: [{ text: buildPrompt(newsText, dateStr, persona) }] }],
    generationConfig: {
      temperature: 0.88,
      topP: 0.92,
      maxOutputTokens: 1024,
    },
    safetySettings: [
      {
        category: "HARM_CATEGORY_HARASSMENT",
        threshold: "BLOCK_MEDIUM_AND_ABOVE",
      },
      {
        category: "HARM_CATEGORY_HATE_SPEECH",
        threshold: "BLOCK_MEDIUM_AND_ABOVE",
      },
      {
        category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
        threshold: "BLOCK_MEDIUM_AND_ABOVE",
      },
      {
        category: "HARM_CATEGORY_DANGEROUS_CONTENT",
        threshold: "BLOCK_MEDIUM_AND_ABOVE",
      },
    ],
  };

  const resp = await fetch(`${ENDPOINT}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    const msg = err?.error?.message || `HTTP ${resp.status}`;
    throw new Error(`Gemini error: ${msg}`);
  }

  const data = await resp.json();

  // Extract text from the first candidate
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text)
    throw new Error(
      "Gemini returned no content. Check your API key and quota.",
    );

  return text.trim();
}
