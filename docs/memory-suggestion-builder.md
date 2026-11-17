# AI suggestion builder

Open **Memory → Suggestions → Create suggestion with AI**. The panel is collapsed by default. The former Plot and Story Card draft forms and recent-play suggestion buttons have been removed from those editors.

Draft from a written brief for Narration Rules, AI Instructions, Plot Essentials, Current Story Arc, Author’s Note, Custom components, or Character, Location, Lore and Custom Story Cards. Choose a new item or an existing destination. Existing singleton components must be updated rather than duplicated. Card updates append; component drafts replace the body while preserving their other controls and Current Arc configuration. Component inclusion is explicit and starts from the existing destination’s value when updating.

For recent-play review, choose Plot Essentials or a Story Card type. Review one destination, or explicitly review relevant selected reference cards of that type. A card review returns separate pending drafts for supported updates. An empty result reports that no supported update was found.

## Context

- Components: None, All, or Selected. All means all supported component types, including inactive items, with their saved controls visible to the model.
- Story Cards: search, filter by type, select across pages, and use the Selected view. Only forty results render per page. Bulk selection names its scope and count.
- Previous entries: the last N saved Chronicle messages, including zero, in source order with speaker and ID. Entries are messages, not exchanges.
- Existing destination: its complete saved item is always supplied.

Full selected content is sent. Other cards, Brains, and hidden history are not automatically added. Reference selection does not authorize changes, except when the user explicitly selects the relevant-card review scope. The manifest shows actual sources and entry count. Estimated input tokens are checked against the configured context allowance, resolved background-provider window when available, response reserve, and a small transport margin. Oversized requests fail without silently shortening content.

## Approval and pacing

These user-requested drafts remain pending even when category auto-approval is enabled or automatic suggestions are hidden. Review and edit the draft before approval. Its destination is fixed; generate another draft to change it. A changed or missing destination blocks approval with an explanation. Old proposals retain their existing behavior.

Always-included Custom components make information available under the existing context budget rules. They do not require repeated mention. Shared authoring guidance establishes supported situations, goals and constraints while leaving future development open. It rejects perpetual buildup, fixed escalation, permanent background activity, and permanent foreground attention.

The autonomous memory evaluator receives no new permission to change Narration Rules, AI Instructions, Author’s Note, or other authoring controls. No new Arc Director phases or pacing behavior are introduced.
