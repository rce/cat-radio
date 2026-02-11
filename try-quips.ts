#!/usr/bin/env npx tsx
/**
 * Quick script to iterate on the WMEW quip prompt.
 * Usage: OPENAI_API_KEY=... npx tsx try-quips.ts [count]
 */

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  console.error("Set OPENAI_API_KEY");
  process.exit(1);
}

const count = Number(process.argv[2]) || 15;

const SYSTEM_PROMPT =
  "You are the DJ host of WMEW 97.3, a cat-obsessed talk radio station from Grand Theft Auto. " +
  "This is GTA satire — dark, absurd, disturbing things said with total sincerity. " +
  "Write a single radio bit. MAX two sentences. Under 25 words total. " +
  "This is NOT cute. NOT charming. NOT heartwarming. NOT whimsical. " +
  "This is GTA. Things should be wrong. Unsettling details delivered casually. " +
  "The listener should think 'wait... what did they just say?' " +
  "BANNED: cat puns of any kind. BANNED: cat takeover/uprising/rebellion themes. " +
  "BANNED: format labels, quotes around output, hashtags, emojis. " +
  "Deadpan. Specific fake names, places, phone numbers, brands. " +
  "Examples of the RIGHT tone: " +
  "- We got Rick from Scarborough on the line. Rick says his cat ate his divorce papers so now technically he's still married. " +
  "- WMEW traffic — there's a cat in the intersection of Broadview and Danforth and nobody is willing to move it. Expect delays through March. " +
  "- Dr. Glen Hoffmeyer is no longer practicing veterinary medicine. We are not allowed to say why. Next caller. " +
  "- Area cat has not blinked in four days. Owners are concerned. The cat is not. " +
  "- Introducing FurGone — the only cat shampoo that also works as an engine degreaser. Not tested on humans. Do not test on humans. " +
  "- Scientists at York University confirmed that cats can see a color humans can't, and they don't like what they're seeing. " +
  "- A man in Parkdale was found shaving neighborhood cats at 3 AM. He says they asked him to. " +
  "- If your cat brings you a dead bird, that's a warning. If it brings you a live one, that's a threat. " +
  "IMPORTANT: Every bit must be a DIFFERENT format and topic than your recent ones.";

const history: { role: string; content: string }[] = [];

for (let i = 0; i < count; i++) {
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history,
    { role: "user", content: "Next WMEW bit. Completely different." },
  ];

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages,
      max_tokens: 50,
      temperature: 1.2,
    }),
  });

  const data = await res.json() as any;
  const text = data.choices?.[0]?.message?.content?.trim();

  if (text) {
    console.log(`\n[${i + 1}/${count}] ${text}`);
    history.push(
      { role: "user", content: "Next WMEW bit. Completely different." },
      { role: "assistant", content: text },
    );
    if (history.length > 10) history.splice(0, 2);
  } else {
    console.error(`\n[${i + 1}/${count}] ERROR:`, JSON.stringify(data));
  }
}

console.log("\n--- Done ---");
