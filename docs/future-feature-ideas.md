# Future Feature Ideas

## Dynamic plot components and automatic generation

Recorded: 2026-10-16

Allow the AI or system to toggle plot components on and off as the story evolves. This could make larger worlds more engaging by bringing relevant plot threads into play and letting others become inactive until they matter again.

Improve how plot components are generated automatically, so a larger world can develop engaging plot material without requiring the player to author every component manually.

Status: future idea; activation rules, generation behavior, and player controls still need design.
## Adaptive context and a more dynamic, living world

Recorded: 2026-10-17

Build a more dynamic and living world through the app's existing components, Story Cards, and character Brains. These surfaces should update more dynamically and accurately with AI as the story develops.

Desired behavior:

- Adjust context dynamically based on the relevant entry and scene context, including how many thoughts are current for a character instead of always using a fixed amount.
- Recognize when a major event is approaching and automatically create or update an appropriate component to represent it.
- Recognize when the sandbox loop is the core play and support that mode of play in the active context.
- Recognize durable changes affecting characters and carry them into the appropriate persistent cards or existing Brains.
- Improve Brain updates to account for developments across the wider world and other characters, beyond reactions to the player's actions alone.
- Make character-card updates reliable and preserve existing entries and established facts when incorporating new information. Revise information when warranted rather than losing unrelated details.

User-reported pain points: Brain updates are useful but could reflect the wider world better. Character-card updates seem almost nonexistent, and when updates do occur they sometimes delete existing card entries. These observations need investigation; they are not yet verified diagnoses.

Preferred direction: improve AI prompting and the context supplied to update passes within the existing architecture. The user suspects much of this can be achieved through better prompting; validate that hypothesis and identify any supporting application changes needed.

This extends the dynamic plot-component idea above. Status: future design and investigation note, not an implementation change. Automatic component creation and changes to AI write permissions need explicit design within the existing mutation and approval boundaries.
