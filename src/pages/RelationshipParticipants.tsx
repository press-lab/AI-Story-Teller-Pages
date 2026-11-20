import type { StoryCard } from "../types/adventure";

export function RelationshipParticipants({ cards, selected, onChange }: {
  cards: readonly StoryCard[];
  selected: readonly string[];
  onChange: (ids: string[]) => void;
}) {
  return <fieldset>
    <legend>Linked Character Cards</legend>
    {cards.filter(card => card.type === "character").map(card => <label key={card.id}>
      <input type="checkbox" checked={selected.includes(card.id)}
        onChange={event => onChange(event.target.checked ? [...selected, card.id] : selected.filter(id => id !== card.id))} />
      {card.title}{card.active ? "" : " (inactive)"}
    </label>)}
  </fieldset>;
}
