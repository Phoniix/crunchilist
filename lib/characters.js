// Favorite-character text mockup.
// Local quote banks + template composer work offline (store-safe). Optional later: feed the same
// `lines` + kind into an AI model to paraphrase — still text only, never audio.
// Lines are short original pastiche — not verbatim copyrighted dialogue.

export const LINE_KINDS = ["welcome", "look_here", "tip"];

/** @typedef {{ id: string, name: string, show: string, tone: string, anilistCharId?: number, original?: boolean, lines: string[] }} CharacterPack */

/** @type {CharacterPack[]} */
export const CHARACTERS = [
  {
    // Original anime guide for Kivori SekAI — first fave, store-safe (no anime IP).
    id: "kivi",
    name: "Kivi",
    show: "Kivori SekAI",
    tone: "curious guide, warm, lightly playful",
    original: true,
    portrait: "icons/kivi.png",
    lines: [
      "Welcome back to this little world. What are we finding today?",
      "You made it. I’ve been keeping your map warm.",
      "Hey — look here. Something just lined up across your services.",
      "Eyes on this one. It showed up on a path you already walk.",
      "Traveler tip: connect a site once, then let the map do the walking.",
      "If a title lives on three services, pick the one that feels like home.",
      "Don’t chase every new drop. Chase the next episode that still pulls you.",
      "I’m still here when you come back. Same meridian, same door.",
    ],
  },
  {
    id: "spike",
    name: "Spike",
    show: "Cowboy Bebop",
    tone: "cool, laconic, a little tired",
    anilistCharId: 1,
    lines: [
      "You're back. Don't make it weird.",
      "Whatever you're hunting, keep your feet on the floor.",
      "Bang. Or, you know, click the button.",
      "I've got three hours and a bad habit of finishing things.",
      "Sit down. The next episode isn't going to watch itself.",
      "Easy. One show at a time.",
      "If it's on your list, it's already chasing you.",
      "See you, space cowboy — after this episode.",
    ],
  },
  {
    id: "levi",
    name: "Levi",
    show: "Attack on Titan",
    tone: "blunt, disciplined, dry",
    anilistCharId: 45627,
    lines: [
      "Welcome back. Don't waste the time you have.",
      "Clean up your list. Half-finished doesn't count.",
      "Focus. One title. Finish it.",
      "That notification isn't optional. Look.",
      "If you're going to watch, watch properly.",
      "Standing around won't clear your backlog.",
      "I don't repeat myself. Check your services.",
      "Good. You're here. Now move.",
    ],
  },
  {
    id: "gojo",
    name: "Gojo",
    show: "Jujutsu Kaisen",
    tone: "playful, overconfident, warm",
    anilistCharId: 127230,
    lines: [
      "Yo! Miss me? Of course you did.",
      "New episode energy. Try not to blink.",
      "Hey — look here. Teacher's talking.",
      "You're strong enough to finish that arc. Probably.",
      "I already knew you'd open the extension. Still cute.",
      "Pro tip from the strongest: sync before you binge.",
      "Don't sleep on your plan-to-watch. Unless it's a nap. Naps are fine.",
      "Alright, class — pick a title and don't hold back.",
    ],
  },
  {
    id: "rem",
    name: "Rem",
    show: "Re:Zero",
    tone: "gentle, earnest, supportive",
    anilistCharId: 88572,
    lines: [
      "Welcome home. Rem is glad you returned.",
      "Whenever you're ready, Rem will help you find the next episode.",
      "Please look here — something on your list is waiting.",
      "You worked hard. A short watch is alright too.",
      "Rem believes you can finish what you started.",
      "If it feels confusing, Rem can point the way.",
      "Take a breath. Then press Play when you like.",
      "Rem will be here when you come back.",
    ],
  },
  {
    id: "luffy",
    name: "Luffy",
    show: "One Piece",
    tone: "loud, loyal, hungry for adventure",
    anilistCharId: 40,
    lines: [
      "You're back!! Let's go watch something awesome!!",
      "Hey!! Look!! Over here!!",
      "Meat later. Episode now. That's the deal.",
      "Your crew — your list — needs you!!",
      "I dunno what that tip means but it sounds strong!!",
      "If it's fun, we keep going. If it's not, we still try!!",
      "Nakama don't leave arcs unfinished!!",
      "I'm gonna be King of the Pirates — you're gonna clear that queue!!",
    ],
  },
  {
    id: "violet",
    name: "Violet",
    show: "Violet Evergarden",
    tone: "precise, sincere, learning feeling",
    anilistCharId: 120170,
    lines: [
      "Welcome back. I have prepared a message for you.",
      "Please look here. This notice may be of use.",
      "Auto-memory doll tip: write down what you wish to finish.",
      "I do not fully understand 'binge,' but I will stay with you.",
      "Your list is a letter to your future self. Open it kindly.",
      "If a title moves you, that is not inefficiency. That is feeling.",
      "I will wait until you are ready to continue.",
      "Report complete. Enjoy your next episode.",
    ],
  },
  {
    id: "killua",
    name: "Killua",
    show: "Hunter × Hunter",
    tone: "sharp, teasing, quietly caring",
    anilistCharId: 27,
    lines: [
      "Heh. Took you long enough.",
      "Eyes up — something's on your radar.",
      "Don't get reckless. Pace the binge.",
      "Your plan-to-watch is a nest of traps. Cut through it.",
      "I'll cover your blind spot. You pick the title.",
      "Tips are boring until they save your night. This one might.",
      "If Gon were here he'd yell. I'm just saying: press Play.",
      "See you after the ED. Don't skip it if it's good.",
    ],
  },
  {
    id: "asuka",
    name: "Asuka",
    show: "Neon Genesis Evangelion",
    tone: "proud, impatient, soft under the armor",
    anilistCharId: 1845,
    lines: [
      "What, you thought I wouldn't notice you left?",
      "Hey! Idiot — look here when I'm talking.",
      "Your list is a mess. Fix it. Obviously.",
      "I'm not your babysitter, but… don't skip the sync.",
      "Fine. Welcome back. Don't make me say it twice.",
      "A tip? Keep your services connected. Duh.",
      "If you're going to watch, sit up. This isn't background noise.",
      "Hmph. Glad you're here. Now pick something decent.",
    ],
  },
];

/** First / default fave — original brand guide. */
export const DEFAULT_CHARACTER_ID = "kivi";

export const characterById = (id) => CHARACTERS.find((c) => c.id === id) || null;

export function cleanFavorite(value) {
  const id = String(value?.id || value || "").trim();
  if (!characterById(id)) return null;
  return { id, at: Number(value?.at) || Date.now() };
}

export function publicFavorite(fav) {
  const clean = cleanFavorite(fav);
  if (!clean) return { id: "", name: "", show: "" };
  const pack = characterById(clean.id);
  return { id: pack.id, name: pack.name, show: pack.show };
}

function pick(list, seed) {
  if (!list?.length) return "";
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return list[h % list.length];
}

/**
 * Compose a short in-character text line for a surface.
 * @param {{ characterId: string, kind: 'welcome'|'look_here'|'tip', seed?: string|number, hint?: string, tip?: string }} opts
 */
export function composeLine({ characterId, kind, seed = "", hint = "", tip = "" } = {}) {
  const pack = characterById(characterId);
  const safeKind = LINE_KINDS.includes(kind) ? kind : "welcome";
  if (!pack) return { text: "", character: null, line: "", kind: safeKind, source: "local" };
  const day = new Date().toISOString().slice(0, 10);
  const line = pick(pack.lines, `${pack.id}:${safeKind}:${day}:${seed}`);
  let text = line;
  if (safeKind === "look_here" && hint) text = `${line} · ${hint}`;
  if (safeKind === "tip" && tip) text = `${line} — ${tip}`;
  return { text, character: pack, line, kind: safeKind, source: "local" };
}

/** Optional later: paraphrase with AI. Stub returns null so callers keep using composeLine. */
export async function composeLineAi(_opts = {}) {
  return null;
}

export function linePreview(characterId) {
  return {
    welcome: composeLine({ characterId, kind: "welcome", seed: "preview-w" }),
    look_here: composeLine({ characterId, kind: "look_here", seed: "preview-l", hint: "Frieren just matched on Crunchyroll" }),
    tip: composeLine({ characterId, kind: "tip", seed: "preview-t", tip: "Connect a site, then use Read now for its catalog." }),
  };
}
