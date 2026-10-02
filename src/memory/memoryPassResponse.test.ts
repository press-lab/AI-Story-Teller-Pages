import { describe, expect, it } from "vitest";
import { parseMemoryPassResponse } from "./memoryPassResponse";

const update = (n: number) => ({ kind: "card", target: `Card ${n}`, content: `Fact ${n}.`, evidence: `quote number ${n} here`, claim: "fact" });

describe("memory pass response parsing", () => {
  it("reads a plain small reply", () => {
    const parsed = parseMemoryPassResponse(JSON.stringify({ updates: [update(1)] }), "stop");
    expect(parsed).toMatchObject({ status: "ok", hadWrapper: false });
    expect(parsed.updates).toHaveLength(1);
  });

  it("accepts zero updates as a complete, valid reply", () => {
    expect(parseMemoryPassResponse('{"updates":[]}', "stop")).toMatchObject({ status: "ok", updates: [] });
  });

  it("strips reasoning tags, code fences, and prose that some OpenRouter models add", () => {
    const reply = `<think>The scene changed location; record it.</think>\nHere is the JSON you asked for:\n\`\`\`json\n${JSON.stringify({ updates: [update(1), update(2)] })}\n\`\`\`\nLet me know if you need more.`;
    const parsed = parseMemoryPassResponse(reply, "stop");
    expect(parsed).toMatchObject({ status: "ok", hadWrapper: true });
    expect(parsed.updates).toHaveLength(2);
  });

  it("does not let braces inside quoted text confuse the scanner", () => {
    const tricky = { ...update(1), content: "She drew a } and a { on the fogged glass." };
    expect(parseMemoryPassResponse(JSON.stringify({ updates: [tricky] })).updates[0]).toEqual(tricky);
  });

  it("recovers complete updates written before a cut-off and drops the half-written one", () => {
    const full = JSON.stringify({ updates: [update(1), update(2), update(3)] });
    const cut = full.slice(0, full.indexOf("Card 3") + 4);
    const parsed = parseMemoryPassResponse(cut, "length");
    expect(parsed.status).toBe("partial");
    expect(parsed.updates).toEqual([update(1), update(2)]);
    expect(parsed.error).toMatch(/cut off by the output ceiling; recovered 2 complete updates/);
  });

  it("reports a cut-off with nothing complete as invalid", () => {
    const parsed = parseMemoryPassResponse('{"updates":[{"kind":"state","target":"Story State","content":"Day/Time: Fri', "length");
    expect(parsed).toMatchObject({ status: "invalid", updates: [] });
    expect(parsed.error).toMatch(/cut off/);
  });

  it("reports a reply that is only reasoning, or empty", () => {
    expect(parseMemoryPassResponse("<think>Let me consider every card in turn and", "length")).toMatchObject({ status: "invalid", error: expect.stringMatching(/empty/) });
  });

  it("reports prose with no JSON, and JSON without an updates array", () => {
    expect(parseMemoryPassResponse("Nothing changed in these turns.").error).toMatch(/no JSON object/);
    expect(parseMemoryPassResponse('{"changes":[]}').error).toMatch(/no "updates" array/);
  });

  it("salvages complete updates from malformed JSON that did close", () => {
    const parsed = parseMemoryPassResponse(`{"updates":[${JSON.stringify(update(1))}, {"kind": "card", "target": oops}]}`, "stop");
    expect(parsed.status).toBe("partial");
    expect(parsed.updates).toEqual([update(1)]);
  });
});
