import { expect, it } from "vitest";
import { buildContext } from "../contextBuilder/contextBuilder";
import { createDefaultAdventure } from "../state/defaults";
import { compareLocalContexts } from "./localCacheDiagnostics";
it("identifies an early story-clock edit without changing the prompt", () => {
  const a = createDefaultAdventure();
  const before = buildContext(a);
  const changed = buildContext({ ...a, storyClock: { ...a.storyClock!, current: { text: "2001-02-03", date: "2001-02-03", precision: "day" } } });
  const original = JSON.stringify(changed);
  expect(compareLocalContexts(before, changed).firstChangedSection).toBe("system");
  expect(JSON.stringify(changed)).toBe(original);
});
it("distinguishes first input, identical input, and sliding recent messages", () => {
  const a = createDefaultAdventure(); const before = buildContext(a);
  expect(compareLocalContexts(undefined, before).previousRequest).toBe(false);
  expect(compareLocalContexts(before, before)).toMatchObject({ previousRequest: true, firstChangedSection: undefined, commonPrefixCharacters: JSON.stringify(before.messages).length });
  const changed = buildContext({ ...a, messages: [{ id: "new", role: "user", content: "I open the door.", createdAt: "2026-01-01" }] });
  expect(compareLocalContexts(before, changed).firstChangedSection).toBe("recentMessages");
});
