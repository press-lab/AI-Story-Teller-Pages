# Relationship Story Cards

Character, Location, Object, Lore, Relationship and Custom are the primary Story Card types. A relationship stores the durable interpersonal history of one exact participant set.

A Relationship Card enters narration only when every linked Character Card survives ordinary retrieval, one-hop chaining and baseline budget trimming. It must fit in full. It can use space from droppable older recent entries. It cannot displace any other selected card, Brain or component, or trigger a further recall.

Automatic extraction uses the default single-pass loose grammar and the existing Other Story Cards approval setting. Older JSON, MEM/DONE, narrator tags and the independent legacy evaluator do not write Relationship Cards. The editor and user-requested memory drafts remain available with either evaluator. Restoring a backup retains broken links on inactive cards for repair. Card-only import validates the entire merged collection before applying it.

## Authoring
* Use the primary Story Card type `relationship` for established, durable interpersonal dynamics between two or more named characters.
* Create a Character Card for every participant first. Link each participant by its actual Character Card ID in `relationship.characterIds`. If authoring a new adventure, create or resolve the character IDs before creating the relationship cards. Do not invent references to missing cards.
* A Relationship Card must link at least two distinct Character Cards. Use one card per exact participant set, regardless of participant order. A group relationship is distinct from the relationships between individual members of the group.
* Use a clear title containing all participating characters' names. Titles are display labels, not relationship identity or triggers.
* Set `keys` to an empty array. A Relationship Card activates automatically only when every linked Character Card is included in the final narration context after ordinary card retrieval, chaining, and budget trimming. Do not define phrase triggers. A single character mention, a Lore card, or an included subset of participants cannot directly activate the Relationship Card.
* Use concise bullets for established friendships, rivalries, family dynamics, shared history, commitments, boundaries and durable ways the participants interact. Attribute asymmetric behavior to the correct character.
* Preserve important historical developments, but write superseded facts as history, not as simultaneous present truths. Do not maintain a separate current-status tracker.
* Add only genuinely new durable interpersonal information. Do not interpret a single routine exchange, temporary emotion or private thought as an established shared relationship.
* Use Lore Cards for specific consequential events and Brains for private beliefs or feelings. A single source may justify both a Lore Card and a Relationship update only if they preserve different information.
* Keep personal behavior and independent life on Character Cards, but place detailed participant-specific dynamics in Relationship Cards. Do not duplicate the same relational history across Character Cards, Lore Cards, components and Brains.
* Do not predefine future friendships, romances, loyalties or betrayals. Relationships describe established information, not narrative instructions.
* This section supersedes earlier AIST authoring guidance that places detailed interpersonal dynamics on individual Character Cards or assigns phrase triggers to Relationship Cards.

Example (illustrative IDs; use actual IDs from the adventure):

    type: relationship
    title: Seth and Elliot
    relationship:
      characterIds: [char_seth, char_elliot]
    keys: []
    inclusionPolicy: triggered
    content:
      • Seth and Elliot have an established friendship built at Brakebills.
      • Elliot treats Seth as a trusted confidant and uses dry humor to deflect vulnerability around him.

When Seth's and Elliot's Character Cards are both included, their Relationship Card may be included within the context budget. When either is absent, it is excluded.
