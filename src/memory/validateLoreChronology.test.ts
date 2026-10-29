import { describe, expect, it } from "vitest";
import { createDefaultAdventure, makeStoryCard } from "../state/defaults";
import { makeMemoryProposal } from "../test/goldenAdventure";
import { readStoryTime } from "./storyTime";
import { resolveLoreEventDate, validateLoreChronology, loreChronologyFingerprint, loreDateConfirmed } from "./validateLoreChronology";
import type { MemoryProposal, StoryTime } from "../types/adventure";

const day = (date: string): StoryTime => ({ text: date, date, precision: "day" });
function fixture(text = "They signed a research agreement.", stored: StoryTime | undefined = day("2001-09-02")) {
  const a = createDefaultAdventure();
  a.storyClock = { current: day("2001-10-01") };
  a.messages = [{ id: "source", content: text, role: "assistant", storyTime: stored, createdAt: "2026-10-29" }];
  const p: MemoryProposal = { ...makeMemoryProposal(), ...({ sourceTurnId: "source", proposedType: "storyCard", storyCardType: "lore", cardOperation: "create",
    title: "2 September — Research Agreement", content: "They signed a research agreement.", lore: { status: "completed", sourceMessageIds: ["source"], occurredAt: stored, lastChangedAt: stored } } satisfies Parameters<typeof makeMemoryProposal>[0]) };
  return { a, p };
}

describe("deterministic Lore chronology", () => {
  it("prefers an explicit source date over stale recorded time and the advanced adventure clock", () => {
    const { a, p } = fixture("September 4, 2001 — Morning\nThey signed a research agreement.");
    const time = resolveLoreEventDate(a, p);
    expect(time?.date).toBe("2001-09-04");
    p.title = "4 September — Research Agreement";
    p.lore = { ...p.lore!, occurredAt: time, lastChangedAt: time };
    expect(validateLoreChronology(a, p)).toEqual({ status: "valid" });
    expect(a.messages[0].storyTime?.date).toBe("2001-09-02");
  });
  it("uses a saved source date even after the clock advances", () => {
    const { a, p } = fixture();
    expect(resolveLoreEventDate(a, p)).toEqual(day("2001-09-02"));
    expect(validateLoreChronology(a, p)).toEqual({ status: "valid" });
    p.title = "4 September — Research Agreement";
    expect(validateLoreChronology(a, p)).toMatchObject({ status: "conflict", reason: expect.stringContaining("4 September") });
    expect(resolveLoreEventDate(a, p)).toEqual(day("2001-09-02"));
  });
  it.each(["around midwinter", "three days before the coronation", "three days before September 4, 2001", "unknown", "12 Frostfall, Year of the Dragon"])("retains textual chronology: %s", text => {
    const stored = readStoryTime("Date: " + text).time!;
    const { a, p } = fixture("They signed a research agreement.", stored);
    p.title = "Research Agreement";
    expect(resolveLoreEventDate(a, p)).toEqual(stored);
    expect(resolveLoreEventDate(a, p)?.date).toBeUndefined();
    expect(validateLoreChronology(a, p).status).toBe("uncertain");
  });
  it("does not date an undated saved source using today's adventure clock", () => {
    const { a, p } = fixture(); delete a.messages[0].storyTime;
    p.lore = { status: "completed", sourceMessageIds: ["source"] };
    expect(resolveLoreEventDate(a, p)).toBeUndefined();
    expect(validateLoreChronology(a, p).status).toBe("uncertain");
  });
  it("uses the established fallback only before the source is persisted", () => {
    const { a, p } = fixture(); a.messages = [];
    expect(resolveLoreEventDate(a, p)).toEqual(day("2001-10-01"));
  });
  it("validates APPEND with lastChangedAt and ignores the earlier card title", () => {
    const { a, p } = fixture("They received exclusive archive access.", day("2001-09-05"));
    a.storyCards = [makeStoryCard({ id: "agreement", type: "lore", title: "3 September — Research Agreement", content: "The initial agreement.",
      lore: { status: "ongoing", sourceMessageIds: [], occurredAt: day("2001-09-03") } })];
    p.targetId = "agreement"; p.cardOperation = "append"; p.title = a.storyCards[0].title;
    p.lore = { ...p.lore!, occurredAt: day("2001-09-03"), lastChangedAt: day("2001-09-05") };
    expect(validateLoreChronology(a, p)).toEqual({ status: "valid" });
    p.content = "4 September — They received archive access.";
    expect(validateLoreChronology(a, p).status).toBe("conflict");
  });
  it("dates a flashback event without changing the present clock", () => {
    const { a, p } = fixture("Flashback: September 1, 2001\nThey signed a research agreement.");
    const before = a.storyClock;
    expect(resolveLoreEventDate(a, p)?.date).toBe("2001-09-01");
    expect(a.storyClock).toBe(before);
  });
  it("ignores future plans and incidental dates in generated prose", () => {
    const { a, p } = fixture();
    p.content = "They agreed to meet on September 5, 2001; the meeting has not happened.";
    expect(validateLoreChronology(a, p)).toEqual({ status: "valid" });
  });
  it("checks both structured CREATE dates and full content prefixes", () => {
    const { a, p } = fixture();
    p.lore!.lastChangedAt = day("2001-09-04");
    expect(validateLoreChronology(a, p).status).toBe("conflict");
    p.lore!.lastChangedAt = day("2001-09-02");
    p.content = "[2001-09-04] They signed the agreement.";
    expect(validateLoreChronology(a, p).status).toBe("conflict");
  });
  it.each(["title", "content", "targetId", "sourceTurnId", "cardOperation"] as const)("binds confirmation to %s and the live source", key => {
    const { a, p } = fixture();
    p.chronologyConfirmationFingerprint = loreChronologyFingerprint(a, p);
    expect(loreDateConfirmed(a, p)).toBe(true);
    expect(loreDateConfirmed(a, { ...p, [key]: "changed" })).toBe(false);
    a.messages[0].content += " Revised evidence.";
    expect(loreDateConfirmed(a, p)).toBe(false);
  });
});


it("does not redate or conflict a reviewed proposal against a later clock when its source is unavailable", () => {
  const { a, p } = fixture();
  a.messages = [];
  const before = structuredClone(p);
  expect(validateLoreChronology(a, p).status).toBe("uncertain");
  expect(p).toEqual(before);
});

it("detects contradictory generated date prefixes without treating either as authoritative", () => {
  const { a, p } = fixture(); delete a.messages[0].storyTime;
  p.lore = { status: "completed", sourceMessageIds: [] };
  p.title = "4 September 2001 — Agreement";
  p.content = "5 September 2001 — They signed the agreement.";
  expect(validateLoreChronology(a, p).status).toBe("conflict");
  expect(resolveLoreEventDate(a, p)).toBeUndefined();
});


it("keeps inconsistent source weekdays under review even when the stored source date is stale", () => {
  const { a, p } = fixture("Wednesday, 4 September 2001\nThey signed an agreement.");
  expect(resolveLoreEventDate(a, p)?.date).toBeUndefined();
  expect(validateLoreChronology(a, p)).toMatchObject({ status: "conflict", reason: expect.stringContaining("Wednesday") });
});


import { pendingLoreDateCorrectionEligibility } from "./validateLoreChronology";
import { loreCorrectionFixture, correctionDay, correctionBatch } from "../test/loreDateCorrection";
import { adventureReducer } from "../state/adventureReducer";
import { reviewedProposal } from "../test/memoryPlacement";

describe("pending Lore date correction eligibility", () => {
  it("allows stale stored chronology and an APPEND's earlier occurrence", () => {
    const a = loreCorrectionFixture();
    for (const id of ["stale", "append"]) expect(pendingLoreDateCorrectionEligibility(a, a.activeState.memoryProposals.find(p => p.id === id)!, a.storyClock!.current)).toEqual({ eligible: true });
  });
  it.each([
    ["scene heading", "September 3, 2001\nMira discovered the lost royal archive."],
    ["flashback", "Flashback: September 3, 2001\nMira discovered the lost royal archive."],
    ["undated flashback", "Mira remembers when she discovered the lost royal archive."],
    ["invalid date", "September 31, 2001\nMira discovered the lost royal archive."],
    ["fictional source date", "Date: Third Frost, Year of the Raven\nMira discovered the lost royal archive."],
  ])("excludes actual %s evidence", (_, content) => {
    const a = loreCorrectionFixture(); a.messages[0].content = content;
    const p = a.activeState.memoryProposals[0]; p.storyCardReview!.sourceContent = content;
    a.activeState.memoryProposals[0] = reviewedProposal(a, p);
    expect(pendingLoreDateCorrectionEligibility(a, a.activeState.memoryProposals[0], a.storyClock!.current)).toMatchObject({ eligible: false, reason: expect.any(String) });
  });
  it.each(["title", "content"] as const)("excludes a conflicting dated %s", key => {
    const a = loreCorrectionFixture(); const p = a.activeState.memoryProposals[0];
    p[key] = "September 3, 2001 — " + p[key];
    const reviewed = reviewedProposal(a, p);
    expect(pendingLoreDateCorrectionEligibility(a, reviewed, a.storyClock!.current)).toMatchObject({ eligible: false, reason: expect.stringContaining("prefix") });
  });
  it.each(["missing", "changed", "empty quote", "empty content", "placement", "destination", "assumed", "invalid", "fictional"])("excludes %s", kind => {
    const a = loreCorrectionFixture(); const p = a.activeState.memoryProposals[0];
    if (kind === "missing") a.messages.shift();
    if (kind === "changed") a.messages[0].content += " Revised.";
    if (kind === "empty quote") p.sourceText = "";
    if (kind === "empty content") p.content = "";
    if (kind === "placement") p.placementValidation = undefined;
    if (kind === "destination") p.targetId = "missing";
    if (kind === "assumed") a.storyClock!.origin = "assumed";
    if (kind === "invalid") a.storyClock!.current = correctionDay("2001-02-30");
    if (kind === "fictional") a.storyClock!.current = { text: "Third Frost", precision: "unknown" };
    expect(pendingLoreDateCorrectionEligibility(a, p, a.storyClock!.current)).toMatchObject({ eligible: false, reason: expect.any(String) });
  });
  it("accepts an explicit matching source date and confirms only the stale stored-date conflict", () => {
    let a = loreCorrectionFixture();
    a = adventureReducer(a, correctionBatch(a, ["stale"]));
    const p = a.activeState.memoryProposals[0];
    expect(validateLoreChronology(a, p).status).toBe("conflict");
    expect(loreDateConfirmed(a, p)).toBe(true);
    expect(loreDateConfirmed(a, { ...p, content: p.content + " Edited." })).toBe(false);
    const matching = loreCorrectionFixture();
    matching.messages[0].content = "Date: September 8, 2001\n" + matching.messages[0].content;
    matching.activeState.memoryProposals[0].storyCardReview!.sourceContent = matching.messages[0].content;
    const reviewed = reviewedProposal(matching, matching.activeState.memoryProposals[0]);
    expect(pendingLoreDateCorrectionEligibility(matching, reviewed, matching.storyClock!.current)).toEqual({ eligible: true });
  });
});


it("invalidates chronology confirmation when supporting exchange evidence changes", () => {
  const a = loreCorrectionFixture(); const p = a.activeState.memoryProposals[0];
  a.messages.push({ id: "support", role: "user", content: "I open the royal archive.", createdAt: "2026-10-29" });
  p.storyCardReview!.additionalSources = [{ id: "support", content: a.messages.at(-1)!.content }];
  p.chronologyConfirmationFingerprint = loreChronologyFingerprint(a, p);
  expect(loreDateConfirmed(a, p)).toBe(true);
  a.messages.at(-1)!.content = "I do not open the royal archive.";
  expect(loreDateConfirmed(a, p)).toBe(false);
});


it("accepts validated joined evidence without requiring all quotes to be one contiguous excerpt", () => {
  const a = loreCorrectionFixture(); const p = a.activeState.memoryProposals[0];
  a.messages[0].content += " Mira catalogued the recovered royal documents.";
  p.storyCardReview!.sourceContent = a.messages[0].content;
  p.sourceText = "Mira discovered the lost royal archive.\nMira catalogued the recovered royal documents.";
  const reviewed = reviewedProposal(a, p);
  expect(pendingLoreDateCorrectionEligibility(a, reviewed, a.storyClock!.current)).toEqual({ eligible: true });
});

it("protects an APPEND with an explicitly conflicting dated title even while its earlier occurrence metadata is allowed", () => {
  const a = loreCorrectionFixture(); const p = a.activeState.memoryProposals[2];
  a.storyCards[0].title = p.title = "September 4, 2001 — Archive agreement";
  const reviewed = reviewedProposal(a, p);
  expect(pendingLoreDateCorrectionEligibility(a, reviewed, a.storyClock!.current)).toMatchObject({ eligible: false, reason: expect.stringContaining("prefix") });
});
