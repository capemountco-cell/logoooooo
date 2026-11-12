// Cleans text pasted from a web page or document before it becomes a brief (pure).
// Deterministic first pass: strips menus, headers/footers, cookie and legal notices, links,
// social buttons and repeated lines, so the brief model sees mostly the brief itself. The model
// is also told to ignore any site chrome that survives.

/** Lines that are page furniture, never part of a brief. */
const JUNK = [
  /\bcookies?\b.*\b(accept|consent|settings|preferences|policy|use)\b|\b(accept|reject) all\b|\bmanage (cookies|preferences)\b/i,
  /\b(privacy policy|terms (of (service|use)|& conditions|and conditions)|cookie policy|accessibility statement|sitemap|legal notice|imprint)\b/i,
  /©|\(c\)\s*\d{4}|\ball rights reserved\b|\bpowered by\b/i,
  /^(skip to (main )?content|skip navigation|back to top|scroll to top|toggle (menu|navigation)|open menu|close menu|main menu|menu|search|search\.\.\.|search…)$/i,
  /^(home|about( us)?|contact( us)?|blog|news|careers|jobs|pricing|faq|help|support|login|log in|sign in|sign up|register|my account|cart|checkout|shop|services|portfolio|team|press)$/i,
  /\b(subscribe to (our|the) newsletter|sign up for (our|the) newsletter|join (our|the) (mailing list|newsletter)|enter your email)\b/i,
  /^(share( this)?( on)?:?|follow us( on)?:?|like us on facebook|tweet|pin it|share on (facebook|twitter|x|linkedin|whatsapp|pinterest))$/i,
  /^(facebook|instagram|twitter|x|linkedin|youtube|tiktok|pinterest|whatsapp|threads|github|dribbble|behance)$/i,
  /^(previous|next|read more|learn more|see more|view all|load more|show more|continue reading|click here|apply now|get started|book (a|now)|buy now|add to cart|download)\s*[›»>→]?$/i,
  /^(posted|published|updated|last updated)( on| by)?\b.{0,40}$/i,
  /^[\s|•·›»>/\\\-–—_=*#]+$/, // separators and breadcrumb glyphs only
  /^\d+\s*(comments?|likes?|shares?|views?|reviews?)$/i,
];

const URL_ONLY = /^(https?:\/\/|www\.)\S+$/i;
const BREADCRUMB = /^[^.!?]{1,80}(\s[›»>/|]\s[^.!?]{1,40}){1,6}$/;

/** Removes link syntax and bare URLs but keeps the link text. */
function stripLinks(line: string) {
  return line
    .replace(/\[([^\]]*)\]\((?:https?:\/\/|mailto:|\/)[^)]*\)/gi, "$1") // markdown links
    .replace(/<a\b[^>]*>(.*?)<\/a>/gi, "$1")
    .replace(/<[^>]+>/g, " ") // other tags
    .replace(/\bhttps?:\/\/\S+|\bwww\.\S+/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

const words = (l: string) => l.split(/\s+/).filter(Boolean).length;
const isSentence = (l: string) => /[.!?:;,]/.test(l) || words(l) > 6;

export type CleanedPaste = { text: string; removed: number };

export function cleanPastedBrief(raw: string): CleanedPaste {
  const lines = raw.replace(/\r\n?/g, "\n").replace(/\u00a0/g, " ").split("\n");
  const kept: string[] = [];
  const seen = new Set<string>();
  let removed = 0;
  // Menus: runs of 4+ consecutive short, sentence-less lines (nav bars, footers, tag clouds).
  const short = lines.map((l) => {
    const t = stripLinks(l);
    return t.length > 0 && t.length <= 28 && words(t) <= 3 && !isSentence(t);
  });
  const inMenu = new Array<boolean>(lines.length).fill(false);
  for (let i = 0; i < lines.length; ) {
    if (!short[i]) { i++; continue; }
    let j = i;
    while (j < lines.length && (short[j] || !lines[j]!.trim())) j++;
    const run = lines.slice(i, j).filter((l) => l.trim()).length;
    if (run >= 4) for (let k = i; k < j; k++) inMenu[k] = true;
    i = j;
  }
  lines.forEach((line, i) => {
    const t = stripLinks(line);
    if (!t) {
      if (line.trim()) removed++;
      if (kept.length && kept[kept.length - 1] !== "") kept.push(""); // keep paragraph breaks
      return;
    }
    const key = t.toLowerCase();
    if (inMenu[i] || URL_ONLY.test(line.trim()) || JUNK.some((re) => re.test(t)) || (BREADCRUMB.test(t) && !isSentence(t.replace(/[›»>/|]/g, ""))) || seen.has(key)) {
      removed++;
      return;
    }
    seen.add(key);
    kept.push(t);
  });
  while (kept.length && kept[kept.length - 1] === "") kept.pop();
  return { text: kept.join("\n").trim(), removed };
}
