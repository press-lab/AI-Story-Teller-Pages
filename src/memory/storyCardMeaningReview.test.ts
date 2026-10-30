import { expect, it } from "vitest";
import { groundedFinding } from "../test/singlePassMemory";
import { storyCardMeaningReviewReason } from "./storyCardMeaningReview";

it.each([
  ["He attempted to kiss her but withdrew before contact.", "They kissed.", true],
  ["They agreed to attend a meeting tomorrow.", "They attended the meeting.", true],
  ["George was absent and did not learn the agreement.", "George secretly knew about the agreement.", true],
  ["It was rumored that the headmaster stole the relic.", "The headmaster stole the relic.", true],
  ["Draconia learned the tattoos fade after several days.", "Draconia learned the tattoos are temporary.", false],
  ["Fred and George agreed to produce rune tattoos tomorrow.", "Fred and George agreed to produce rune tattoos tomorrow.", false],
  ["They shared their first kiss.", "They shared their first kiss.", false],
  ["Hermione accepted the invitation to meet.", "Hermione accepted the invitation to meet.", false],
  ["The twins might eventually produce rune tattoos. The twins gained permission to use the workshop.", "The twins gained permission to use the workshop.", false],
  ["Fred and George might produce rune tattoos next week. The research team gained access to the library archives.", "The research team gained access to the library archives.", false],
])("checks action and outcome relevance: %s -> %s", (source, content, review) => {
  expect(Boolean(storyCardMeaningReviewReason({ ...groundedFinding(), content }, [{ content: source }]))).toBe(review);
});
