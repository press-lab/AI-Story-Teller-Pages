import type { Message, StoryCard, StoryCardType } from "../types/adventure";

const personTitles = "captain professor minister commander doctor lord lady king queen prince princess sir dame wizard witch".split(" ");
const organizations = "department ministry order guild council alliance syndicate company".split(" ");
const places = "tower castle citadel academy forest harbor harbour manor hall city village".split(" ");
// Grammatical tokens cannot form a proper name, even when capitalized in dialogue/headings.
const grammar = new Set("i you he she it we they me him her us them my your his its our their mine yours ours theirs this that these those some any all each every both either neither anyone someone everyone something anything nothing and or but if then as perhaps meanwhile however therefore yes no".split(" "));
const connectors = new Set(["of", "the"]);
const genericHeads = new Set([...personTitles, ...organizations, ...places]);
const speech = "(?:says|said|asks|asked|replies|replied|answers|answered|whispers|whispered|shouts|shouted|finishes|finished|adds|added|murmurs|murmured)";

function entityName(text: string): string {
  return text.normalize("NFKC").trim().replace(/^["“”'‘’]+|["“”'‘’]+$/gu, "")
    .replace(/^(?:The|A|An)\s+/, "").replace(/['’]s$/iu, "").trim();
}
const entityKey = (text: string) => entityName(text).toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const withoutTitle = (text: string) => entityKey(text).replace(new RegExp(`^(?:${personTitles.join("|")})\\s+`, "i"), "");

interface EntityMention { name: string; start: number; end: number }

/** Capitalization only extracts spans. It never qualifies them as identities. */
function entityMentions(text: string): EntityMention[] {
  const word = "\\p{Lu}[\\p{L}\\p{M}]*(?:['’\\-]\\p{L}[\\p{L}\\p{M}]*)*";
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}\\-])(?<!\\p{L}['’])${word}(?:[ -](?:(?:of the|of|the) )?${word}){0,3}(?:['’](?!\\p{L}))?`, "gu");
  return [...text.matchAll(pattern)].map(match => ({ name: entityName(match[0]), start: match.index, end: match.index + match[0].length }))
    .filter(({ name }) => {
      const words = name.toLocaleLowerCase().split(/[\s-]+/);
      return name.length >= 3 && name.length < 80 && !words.some(word => grammar.has(word))
        && !(personTitles.includes(words[0]) && words.some(word => connectors.has(word)))
        && words.some(word => !connectors.has(word) && !genericHeads.has(word));
    });
}

/** Exact title/alias coverage first; a single surname may also resolve a known person.
 * Multiple surname matches remain covered/ambiguous, never a new duplicate person.
 */
function matchingEntities(cards: StoryCard[], name: string): StoryCard[] {
  const key = withoutTitle(name);
  const exact = cards.filter(card => [card.title, ...card.keys].some(alias => withoutTitle(alias) === key));
  if (exact.length) return exact;
  return !key.includes(" ") ? cards.filter(card => card.type === "character"
    && [card.title, ...card.keys].some(alias => withoutTitle(alias).split(" ").at(-1) === key)) : [];
}

/** Participants are resolved identities, never capitalization guesses. Explicit model
 * participants use the same title/alias/possessive normalization as entity coverage.
 */
export function characterParticipants(cards: StoryCard[], text: string, provided?: string[]): string[] {
  const characters = cards.filter(card => card.type === "character");
  if (provided) return [...new Set(provided.flatMap(name => {
    const matches = matchingEntities(characters, name);
    return matches.length === 1 ? [matches[0].title] : [];
  }))].slice(0, 8);

  const normalized = ` ${entityKey(text.replace(/([\p{L}\p{M}])['’]s\b/giu, "$1"))} `;
  const references = new Map<string, Set<StoryCard>>();
  for (const card of characters) {
    const names = [card.title, ...card.keys].map(withoutTitle);
    const surname = withoutTitle(card.title).split(" ").at(-1)!;
    if (surname.length >= 3 && !genericHeads.has(surname)) names.push(surname);
    for (const name of names.filter(Boolean)) {
      const matches = references.get(name) ?? new Set<StoryCard>();
      matches.add(card);
      references.set(name, matches);
    }
  }
  return [...new Set([...references].flatMap(([name, matches]) => matches.size === 1 && normalized.includes(` ${name} `)
    ? [[...matches][0].title] : []))].slice(0, 8);
}

function namedType(name: string): StoryCardType | undefined {
  const words = name.toLocaleLowerCase().split(/[\s-]+/);
  const specific = words.filter(word => !connectors.has(word) && !genericHeads.has(word));
  if (!specific.length) return undefined;
  if (words.some(word => organizations.includes(word))) return "custom";
  if (words.some(word => places.includes(word))) return "location";
  if (personTitles.includes(words[0]) && words.length > 1) return "character";
  return undefined;
}

function characterEvidence(text: string, mention: EntityMention): "explicit" | "personal" | undefined {
  const before = text.slice(Math.max(0, mention.start - 100), mention.start);
  const after = text.slice(mention.end, mention.end + 120);
  // These cues must attach to this name, not just occur elsewhere in its sentence.
  if (/\b(?:meet|meets|met|introduce|introduces|introduced)\s+$/i.test(before)
    || /\b(?:person|man|woman|child|wizard|witch|elf|dragon|owl|goblin|companion|familiar)\s+(?:named|called)\s+$/i.test(before)
    || /^\s+(?:(?:enters?|arrives?)\s+and\s+)?introduc(?:es|ed)\s+(?:herself|himself|themselves)\b/i.test(after)) return "explicit";
  if ((/["”']\s*,?\s*$/.test(before) && new RegExp(`^\\s+${speech}\\b`, "i").test(after))
    || new RegExp(`^\\s+${speech}\\s*,?\\s*["“]`, "i").test(after)) return "explicit";
  // Repeated person-specific actions can corroborate a single-name character.
  // Generic appearances/movement, and repetition alone, do not qualify.
  if (/^\s+\p{Ll}[\p{L}]*\s+(?:his|her|their)\s+(?:arms|hands|head|eyes|voice)\b/u.test(after)) return "personal";
  return undefined;
}

function quoteAt(text: string, index: number): string {
  const start = Math.max(...["\n", ".", "!", "?"].map(mark => text.lastIndexOf(mark, index - 1))) + 1;
  const end = text.slice(index).search(/[\n.!?]/u);
  return text.slice(start, end < 0 ? undefined : index + end + 1).trim();
}

/** Qualify locally before applying the existing bounded frequency/recency ranking. */
export function storyCardEntityCandidates(text: string, recent: Message[], cards: StoryCard[]) {
  const history = recent.map(message => ({ message, mentions: entityMentions(message.content) }));
  return entityMentions(text).filter((mention, index, all) => all.findIndex(other => entityKey(other.name) === entityKey(mention.name)) === index)
    .filter(mention => !matchingEntities(cards, mention.name).length)
    .flatMap(mention => {
      const key = entityKey(mention.name);
      const occurrences = history.filter(entry => entry.mentions.some(other => entityKey(other.name) === key));
      const currentEvidence = characterEvidence(text, mention);
      const supporting = occurrences.flatMap(entry => entry.mentions.filter(other => entityKey(other.name) === key)
        .map(other => ({ message: entry.message, evidence: characterEvidence(entry.message.content, other) })));
      const explicit = supporting.find(entry => entry.evidence === "explicit");
      const personal = supporting.filter((entry, index, all) => entry.evidence === "personal" && all.findIndex(other => other.message.id === entry.message.id && other.evidence === "personal") === index);
      const named = namedType(mention.name);
      const type = named ?? (currentEvidence === "explicit" || explicit || personal.length >= 2 ? "character" : undefined);
      if (!type) return [];
      const support = currentEvidence !== "explicit" && !named
        ? explicit ? [explicit.message] : personal.map(entry => entry.message) : [];
      const rank = recent.reduce((score, message, index) => score + (occurrences.some(entry => entry.message.id === message.id) ? 1 + (index + 1) / Math.max(1, recent.length) : 0), 0);
      return [{ name: mention.name, type, evidence: quoteAt(text, mention.start), support,
        occurrences: occurrences.length, rank,
        reason: named ? "A specific proper name with an attached person title or named place/organization." : explicit || currentEvidence === "explicit" ? "Candidate-specific introduction or dialogue attribution." : "Repeated character-specific actions support this single-word name." }];
    });
}
