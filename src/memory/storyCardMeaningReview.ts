import type { SinglePassMemoryFinding } from "../types/adventure";

const tentative = /\b(?:rumou?r(?:s|ed)?|allegedly|reportedly|supposedly|it is possible|possibly|perhaps|maybe|might|may have|could have|speculat\w*|unconfirmed|uncertain|suspect\w*|seem(?:s|ed)?|apparently)\b/i;
const privateClaim = /\b(?:privately|secretly|internally)\s+(?:believ\w*|kn\w*|knew|decid\w*|thought|felt|realiz\w*|understood)|\b(?:believ\w*|knew|thought|felt|assum\w*)\b/i;
const incomplete = /\b(?:attempt\w*|tried|planned?|planning|intend\w*|tomorrow|will|would|invitation|invited|interrupted|declined|failed|refused|withdrew|withdrawn|stopped|before contact|never|did not|didn.t|not (?:yet )?(?:occurred|happened|completed))\b/i;
const retainedModality = /\b(?:attempt\w*|tried|planned?|planning|intend\w*|tomorrow|will|would|agreed to|accepted .*invitation|invited|interrupted|declined|failed|refused|withdrew|withdrawn|stopped|no kiss|not (?:yet )?(?:occurred|happened|completed))\b/i;
const normalize = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const terms = (text: string) => normalize(text).split(" ").filter(t => t.length > 3 && !["they", "their", "that", "this", "with", "were", "have", "from", "before", "after"].includes(t));
const actionStem = (word: string) => ({ met: "meet", attended: "attend", kissed: "kiss", stole: "steal", stolen: "steal", knew: "know", went: "go", took: "take", made: "make" }[word]
  ?? word.replace(/(?:ing|ed|s)$/, "")).replace(/e$/, "");
const plannedActions = (text: string) => [...text.toLowerCase().matchAll(/\b(?:(?:attempt\w*|tried|plan\w*|intend\w*|declined|failed|refused|agreed) to|will|would)\s+(\w+)/g)].map(m => actionStem(m[1]));
const hasAction = (text: string, action: string) => normalize(text).split(" ").some(word => actionStem(word) === action);
const outcomes = [
  { topic: /\bkiss\w*\b/i, completed: /\bkissed\b|\bshared (?:their |a |the |first )*kiss\b/i },
  { topic: /\bmeet\w*|\bmeeting|\bdinner\b/i, completed: /\b(?:met|attended|held)\b|\b(?:meeting|dinner) (?:occurred|happened|took place)\b/i },
  { topic: /\baccess|\barchives?\b/i, completed: /\b(?:gained|received|obtained) access\b/i },
  { topic: /\bproduc\w*|\bship\w*|\btattoos?\b/i, completed: /\b(?:produced|shipped|delivered|finished|completed)\b/i },
];

// A shared name or topic is insufficient: require the same action/outcome as well.
const actionWords = /^(?:kiss\w*|meet\w*|met|attend\w*|steal\w*|stole|stolen|know\w*|knew|believ\w*|thought|felt|assum\w*|learn\w*|gain\w*|obtain\w*|receiv\w*|produc\w*|ship\w*|deliver\w*|accept\w*|declin\w*|agre\w*|discover\w*|reveal\w*|tak\w*|took|mak\w*|made|us[ei]\w*|enter\w*|destroy\w*|kill\w*|open\w*|clos\w*)$/;
const actions = (text: string) => normalize(text).split(" ").filter(word => actionWords.test(word)).map(actionStem);
function related(left: string, right: string): boolean {
  const leftActions = actions(left);
  const sameAction = plannedActions(right).some(action => hasAction(left, action))
    || leftActions.some(action => actions(right).includes(action))
    || outcomes.some(outcome => outcome.completed.test(left) && outcome.topic.test(right));
  if (!sameAction) return false;
  const sharedObjectOrSubject = terms(left).some(term => !actionWords.test(term) && terms(right).includes(term));
  // Pronouns can carry the subject for an explicit outcome ("They kissed").
  return sharedObjectOrSubject || /\b(?:they|he|she|her|him|them)\b/i.test(left)
    && outcomes.some(outcome => outcome.completed.test(left) && outcome.topic.test(right));
}

/** Local risk checks, not a semantic proof. Evidence must already pass source validation.
 * Compare factual clauses rather than topics, titles, rationale, or event-status defaults.
 */
export function storyCardMeaningReviewReason(finding: SinglePassMemoryFinding, evidence: readonly { content: string }[]): string | undefined {
  const proposed = finding.content ?? "";
  if (["location", "custom"].includes(finding.storyCardType ?? "") && /\b(?:permanently|enduring (?:profile|trait)|personality|voice contract)\b/i.test(proposed)
    && finding.participants?.length) return "Character profile changes require Character placement and author review.";
  if (tentative.test(proposed)) return "Uncertain event interpretation: the proposed conclusion is tentative.";
  const source = evidence.flatMap(e => e.content.split(/(?<=[.!?])\s+|\n+/)).filter(Boolean);
  const clauses = proposed.split(/(?<=[.!?])\s+|;\s*|\s+(?:and|but)\s+/i).filter(Boolean);
  for (const clause of clauses) {
    const matching = source.filter(s => related(clause, s));
    const direct = matching.some(s => !tentative.test(s) && normalize(s).includes(normalize(clause)));
    if (privateClaim.test(clause) && !direct) return "Uncertain event interpretation: private knowledge or interpretation lacks supporting narrator disclosure.";
    if (matching.some(s => tentative.test(s)) && !direct) return "Unsupported certainty: source evidence frames this claim as rumor, possibility, or speculation.";
    if (!retainedModality.test(clause)) {
      const planned = matching.flatMap(plannedActions).filter(action => hasAction(clause, action));
      if (planned.some(action => !matching.some(s => hasAction(s, action) && !incomplete.test(s) && !tentative.test(s)))) {
        return "Unsupported completion: source evidence plans or attempts the action without establishing its completion.";
      }
      for (const outcome of outcomes) {
        if (!outcome.completed.test(clause)) continue;
        const relevant = matching.filter(s => outcome.topic.test(s));
        if (relevant.some(s => incomplete.test(s)) && !relevant.some(s => outcome.completed.test(s) && !incomplete.test(s) && !tentative.test(s))) {
          return "Unsupported completion: source evidence establishes an attempted, interrupted, declined, or planned action.";
        }
      }
    }
  }
  return undefined;
}
