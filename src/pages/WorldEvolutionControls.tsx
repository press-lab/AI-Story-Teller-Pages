import type { WorldEvolutionSettings } from "../types/adventure";
import { worldPresetName, worldPresets } from "../memory/worldPresets";
import { CheckboxField, Field } from "./shared";

export function WorldEvolutionControls({ settings, onChange }: { settings: WorldEvolutionSettings; onChange: (patch: Partial<WorldEvolutionSettings>) => void }) {
  return <article className="panel" aria-label="Scenario Configuration">
    <h3>Scenario Configuration — World Evolution</h3>
    <p className="muted">Saved with this adventure. Permissions guide narration; each memory system retains its own validation and ownership. Character protections override these permissions.</p>
    <CheckboxField label="Enable World Evolution" checked={settings.enabled === true} onChange={enabled => onChange({ enabled })} />
    {!settings.enabled && <p className="muted">Off preserves legacy memory behavior and stored world history.</p>}
    <Field label="World Dynamism">
      <select value={worldPresetName(settings)} onChange={e => { const preset = worldPresets[e.target.value]; if (preset) onChange({ ...preset }); }}>
        {Object.keys(worldPresets).concat("Custom").map(name => <option key={name}>{name}</option>)}
      </select>
    </Field>
    <p className="muted">Quiet: player-driven. Natural: organic development. Living: independent NPCs and consequences. Unpredictable: more concurrent conflicts and major twists when earned by events. Permissions never require a twist.</p>
    <details><summary>Advanced World Evolution</summary>
      {([
        ["plotProgression", "Plot progression", ["off", "natural", "active"], "Off disables plot advancement; Natural follows established events; Active encourages meaningful progress without a turn schedule."],
        ["plotResolution", "Plot resolution", ["openEnded", "decisive"], "Controls pursuit of closure. Confirmed central-objective outcomes are always recorded when progression is enabled."],
        ["newPlotGeneration", "New plot generation", ["off", "occasional", "frequent"], "Controls emerging major conflicts; existing plots have separate progression permissions."],
        ["npcAutonomy", "NPC autonomy", ["reactive", "independent"], "Reactive NPCs respond to the scene; Independent NPCs may pursue their own goals."],
        ["betrayal", "Betrayal", ["off", "earned", "unrestricted"], "Off prohibits autonomous betrayal; Earned requires established motivation; Unrestricted permits it without requiring it."],
        ["redemption", "Redemption", ["off", "earned", "unrestricted"], "Controls lasting moral change and required motivation."],
        ["canonReinterpretation", "Canon reinterpretation", ["off", "review", "allowed"], "Controls reinterpretation of established canon; Review always requires approval."],
      ] as const).map(([key, label, options, description]) => <Field key={key} label={label}><select aria-label={label} value={settings[key]} onChange={e => onChange({ [key]: e.target.value })}>{options.map(option => <option key={option} value={option}>{option === "openEnded" ? "Open-ended" : option}</option>)}</select><p className="muted">{description}</p></Field>)}
      {([
        ["offscreenEvents", "Offscreen events", "Permits established events away from the player when NPC autonomy is Independent."],
        ["characterDevelopment", "Character development", "Permits autonomous durable character changes. Temporary emotions, dialogue, thoughts and enrolled relationships remain separate."],
        ["relationshipEvolution", "Relationship evolution", "Permits automatic proposals through enrolled Brain relationships. Manual editing and history remain available."],
        ["hiddenMotivations", "Hidden motivations", "Permits evidenced concealed motives; does not give absent NPCs knowledge."],
      ] as const).map(([key, label, description]) => <div key={key}><CheckboxField label={label} checked={settings[key]} onChange={value => onChange({ [key]: value })} /><p className="muted">{description}</p></div>)}
    </details>
  </article>;
}
