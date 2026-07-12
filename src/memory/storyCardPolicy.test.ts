import { describe, expect, it } from "vitest";
import { makeStoryCard } from "../state/defaults";
import { storyCardContextContent } from "./storyCardPolicy";

describe("storyCardContextContent", () => {
  it("renders condensed raw content when compact structured facts are cleared", () => {
    const card = makeStoryCard({
      title: "Seth's Pact",
      content: "Condensed pact context.",
      compactKind: "pact",
      compactStatus: "active",
      coreFacts: [],
      currentFacts: [],
      recentDevelopments: [],
    });

    expect(storyCardContextContent(card)).toBe("Condensed pact context.");
  });
});
