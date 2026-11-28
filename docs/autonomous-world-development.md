# Autonomous World Development

Open a Character, Location, Object, Relationship, or Custom Story Card. **Autonomous World Development** is at the top of its editor. Enable it to let the memory model propose off-screen events involving that card. Active enabled subjects are considered even when their triggers do not match the scene. Lore stores the resulting events.

The existing single-pass memory request handles both ordinary extraction and autonomous generation. Only the newest selected narrator entry can authorize autonomous generation, and only when it is the latest finalized in-story narrator entry in the Chronicle. The normal idle flush follows the same rule. A historical catch-up batch or explicit retry extracts ordinary memory only. Loading or importing an adventure does not initiate generation. Communications and the manual Memory Suggestion Builder do not authorize it.

The memory evaluator gets complete authored subject content, up to five approved developments per subject, and up to five pending, rejected, or ignored developments as noncanonical references. It can return no event. A subject can appear in at most one autonomous operation in an evaluation.

## Operation grammar

```text
S3
(storyCard.lore.autonomous: Annex shutter repairs = Wardens repaired the eastern shutters. || A1 + A2 || Annex wardens; Gate guards)
```

`A1` and `A2` refer to the authorized source manifest. The last field is a semicolon-separated list of knowledge holders. Use `NONE` when no knowledge holder has been established. Record reports, beliefs, and suspicions as such. The application saves the list in Lore's existing Known to field.

Autonomous operations create standalone Lore cards. They cannot append to or replace existing cards, and automatic Lore routing cannot append to an autonomous event. The author can edit the event body, approve it, reject it, or ignore it.

## Approval and provenance

**Story Cards — Autonomous Lore** in Memory Suggestions controls automatic approval independently of **Story Cards — Lore**. Both settings default off in new adventures. Missing autonomous settings in older adventures default off. Pending, rejected, and ignored suggestions do not establish world events. Once approved, a development is saved as Lore and can inform later autonomous generation.

The application saves the originating card IDs, narrator source ID and revision, and memory batch ID. The narrator entry supplies generation context and, when known, the story time. It supplies no direct evidence of the generated event. The Story Card and Memory Suggestions display the origin, including saved IDs for deleted subjects.

The subject switch affects memory generation only. Narration uses the existing Story Card selection, triggers, and recall rules for approved Lore.
