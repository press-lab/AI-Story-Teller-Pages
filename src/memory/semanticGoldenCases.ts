/** Private case manifests are supplied locally; no gameplay corpus is bundled.
 * Rubrics are evaluated after inference and never inserted into model requests. */
export interface GoldenMemoryCase {
  id: string;
  sourceIds: string[];
  canon?: {
    removeCardIds?: string[];
    cardContents?: Record<string, string>;
    clearSummary?: boolean;
  };
  expectation: "must" | "may" | "empty";
  review: "user-requirement" | "developer-provisional";
  rationale: string;
  concepts?: string[][];
  forbidden?: string[];
  acceptance?: {
    singleLore?: boolean;
    historical?: boolean;
    title?: string;
    requiredEvidenceMessageIds?: string[];
  };
}
