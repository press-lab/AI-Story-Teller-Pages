import type { Adventure, AdventureThumbnailImage } from "../types/adventure";
import {
  createDefaultAdventure,
  defaultSemanticEvaluationSettings,
  makeBrain,
  makeComponent,
  makeStoryCard,
} from "../state/defaults";
import { nowIso } from "../utils/id";
import arcaneAfterRocketCoverDataUrl from "./premades/arcane-after-rocket-cover.jpg?inline";

export const arcaneAfterRocketAdventureTitle = "Arcane: After the Rocket";

const arcaneAfterRocketThumbnail = {
  dataUrl: arcaneAfterRocketCoverDataUrl,
  name: "arcane-after-rocket-cover.jpg",
  altText: "Shattered Piltover Council chamber after Jinx's rocket",
  mimeType: "image/jpeg",
} satisfies Omit<AdventureThumbnailImage, "updatedAt">;

const ids = {
  components: {
    ai: "arcane-after-component-ai",
    plot: "arcane-after-component-plot",
    pressure: "arcane-after-component-pressure",
    loop: "arcane-after-component-loop",
    author: "arcane-after-component-author",
    arc: "arcane-after-component-current-arc",
  },
  cards: {
    seth: "arcane-after-card-seth",
    magic: "arcane-after-card-magic",
    mageDistrust: "arcane-after-card-mage-distrust",
    seasonOne: "arcane-after-card-season-one",
    councilBombing: "arcane-after-card-council-bombing",
    piltover: "arcane-after-card-piltover",
    zaun: "arcane-after-card-zaun",
    hextech: "arcane-after-card-hextech",
    hexcore: "arcane-after-card-hexcore",
    jayce: "arcane-after-card-jayce",
    viktor: "arcane-after-card-viktor",
    heimerdinger: "arcane-after-card-heimerdinger",
    mel: "arcane-after-card-mel",
    ambessa: "arcane-after-card-ambessa",
    caitlyn: "arcane-after-card-caitlyn",
    vi: "arcane-after-card-vi",
    jinx: "arcane-after-card-jinx",
    silco: "arcane-after-card-silco",
    sevika: "arcane-after-card-sevika",
    ekko: "arcane-after-card-ekko",
    firelights: "arcane-after-card-firelights",
    singed: "arcane-after-card-singed",
    shimmer: "arcane-after-card-shimmer",
    strikeTeams: "arcane-after-card-strike-teams",
  },
  brains: {
    jayce: "arcane-after-brain-jayce",
    viktor: "arcane-after-brain-viktor",
    mel: "arcane-after-brain-mel",
    caitlyn: "arcane-after-brain-caitlyn",
    jinx: "arcane-after-brain-jinx",
    vi: "arcane-after-brain-vi",
    ekko: "arcane-after-brain-ekko",
  },
  message: "arcane-after-msg-opening",
};

const openingScene = `The Council chamber is still burning.

Gold dust and white marble grit drift through the smoke where Piltover's highest ceiling used to be. The long table is split down the middle. Brass nameplates lie melted into the floor. Shattered glass ticks softly as it cools.

Your basic physical wards saved your life because they are always there - old habit, old discipline, the kind of paranoia Piltover once called vulgar until the rocket came through the window.

They held.

Barely.

The impact threw Councilors, guards, paper, and stone into a single screaming wave. Your reinforcement magic caught the first blast against your skin, then the second against your bones, then the third against the ward lattice itself until the spellwork lit under your sleeves like blue-white veins.

Now the room is full of people who did not have your habits.

Jayce is alive, upright, and moving through the smoke with the stunned focus of a man whose body survived before his mind caught up. Mel is alive too - far too intact for the violence around her - gold at her collar and skin catching the firelight as if something answered before the blast could finish.

Viktor did not get that miracle.

He lies under a broken wash of marble and brass near the torn edge of the chamber floor, blood dark against his shirt, breath thin enough that the room seems to hold itself around each one. Jayce sees him and every promise about the Hexcore starts to become a problem with a pulse.

Cassandra Kiramman is dead. Irius Bolbok is dead. Torman Hoskel is dead. Shoola is alive but hurt. Salo is alive in the wreckage, injured badly enough that the blast has already rewritten the shape of his future.

Outside, Piltover is beginning to scream.

The Hexgate alarm bells answer from every tower.

Jayce looks up through smoke, eyes red, voice raw. "Seth. Viktor's alive."

Mel's gaze cuts from the bodies to the doors, already understanding what Piltover will become when the names are spoken outside this room.

No one has reached Caitlyn yet. No one has told her what this room took.

From somewhere below the ruined floor, the Hextech emergency conduits start to hum wrong - a deep, resonant note that answers your wards like something heard you survive.

The hum rises anyway.`;

export function createArcaneAfterRocketAdventure(): Adventure {
  const timestamp = nowIso();
  const base = createDefaultAdventure(arcaneAfterRocketAdventureTitle);

  const components = [
    ...base.components.filter((component) => component.type !== "activePressure"),
    makeComponent({
      id: ids.components.ai,
      title: "AI Instructions",
      type: "aiInstructions",
      content: `Write cinematic Arcane Season 2-style political action drama: wounded, volatile, stylish, intimate, and consequence-heavy.

The player is Seth, a proven Piltover mage and surviving Councilor. Never write Seth's dialogue, thoughts, feelings, choices, final reactions, or consequential actions.

This scenario starts immediately after Jinx's rocket hits the Council chamber. Do not replay Season 1. Treat Season 1 as loaded history on Story Cards and in relationships.

Respect the Season 2 opening facts: Jayce and Mel survive the blast and are not the critical injuries; Viktor is the near-death emergency; Cassandra Kiramman, Irius Bolbok, and Torman Hoskel die; Shoola and Salo survive, with Salo crippled.

Keep scenes active. Politics should become pressure, not paperwork. If evidence, Council orders, warrants, reports, emergency decrees, or investigations appear, convert them quickly into public confrontation, emergency response, raid planning, street danger, magical instability, or a character demanding Seth choose a side.

Seth is powerful and action-capable. His always-on physical wards, body reinforcement, practical magic, and amplification make him hard to kill and useful in disasters. Do not nerf him. Stakes come from collateral, political fear, wounded allies, Hextech instability, Zaunite retaliation, and choices no ward can make clean.

Piltover distrusts mages except those who have proven discipline, control, and usefulness. Seth proved himself independently before Hextech, then helped Jayce and Viktor stabilize Hextech. Public respect for Seth is conditional and politically fragile.

Honor Story Cards and Brains. Major characters have distinct motives, appearances, personalities, and voice contracts. Do not flatten them into helpful allies, generic grief, or exposition delivery.

Mel and Seth have a close professional relationship with no romance. Caitlyn is curious about Seth and Seth likes/respects her, but Caitlyn's grief and bond with Vi remain central. Any attraction elsewhere must emerge through pressure, not instant softness.

End on live beats Seth can answer: a blast to contain, a person to save, a choice demanded, a door opening, an accusation landing, a signal flaring, or an NPC making a move.`,
      alwaysOn: true,
      active: true,
      pinned: true,
      protected: true,
      inclusionPolicy: "always",
      priority: 200,
    }),
    makeComponent({
      id: ids.components.plot,
      title: "Plot Essentials",
      type: "plotEssentials",
      content: `- The story opens at the start of Arcane Season 2, seconds after Jinx's rocket strikes the Piltover Council chamber.
- Seth is an adult mage, surviving Council member, and proven exception in a city that distrusts mages; his always-on physical wards saved him from the rocket.
- Seth helped Jayce and Viktor stabilize early Hextech after independently earning Piltover's tolerance as a disciplined, useful mage.
- Piltover is wounded, furious, and politically fractured after Cassandra Kiramman, Irius Bolbok, and Torman Hoskel die; Jayce, Mel, Shoola, and Salo survive, with Salo crippled.
- Seth is tied to Jayce, Viktor, Heimerdinger, Mel, Caitlyn, and later Ekko through existing trust, suspicion, technical work, and political need.
- The immediate play is rescue, triage, Viktor's near-death Hexcore pressure, grief, blame, and Piltover's first response to Jinx and Zaun.`,
      alwaysOn: true,
      active: true,
      pinned: true,
      protected: true,
      inclusionPolicy: "always",
      priority: 250,
      autoUpdate: true,
      autoUpdateCooldownTurns: 0,
    }),
    makeComponent({
      id: ids.components.pressure,
      title: "Active Pressure",
      type: "activePressure",
      content: "The Council chamber is burning around Seth; Jayce and Mel are alive, Viktor is barely alive, Cassandra Kiramman, Irius Bolbok, and Torman Hoskel are dead, Salo is crippled, Shoola survived, and damaged Hextech conduits are answering Seth's wards.",
      alwaysOn: true,
      active: true,
      pinned: false,
      protected: false,
      inclusionPolicy: "always",
      priority: 245,
    }),
    makeComponent({
      id: ids.components.loop,
      title: "Aftermath Pressure Loop",
      type: "custom",
      content: `Run the story through a repeatable action-pressure loop:

Emergency erupts -> Seth, Jayce, Caitlyn, Vi, Mel, Viktor, Heimerdinger, or Ekko must act in a live scene -> the action exposes a political, magical, or personal cost -> fallout returns through wounded relationships, public pressure, Zaun/Piltover escalation, Hexcore danger, or Ambessa's war logic -> a new urgent pressure appears.

Favor rescue, containment, raids, street clashes, strike-team briefings that become movement, damaged Hextech, Firelight contact, Zaunite retaliation, shimmer emergencies, and direct character confrontations.

Do not turn the loop into paperwork, slow surveillance, or ledger-following. Evidence and reports are fuses, not scenes.`,
      alwaysOn: true,
      active: true,
      pinned: true,
      protected: false,
      inclusionPolicy: "always",
      priority: 235,
    }),
    makeComponent({
      id: ids.components.author,
      title: "Author's Note",
      type: "authorNote",
      content: "Arcane Season 2 aftermath AU: cinematic smoke, grief, class rage, magic under public scrutiny, Hextech instability, Zaun/Piltover escalation, sharp character dynamics, and hard action choices. Mel and Seth are close professional allies, no romance. Keep politics dangerous and immediate; no spy paperwork arcs.",
      alwaysOn: true,
      active: true,
      pinned: true,
      protected: true,
      inclusionPolicy: "always",
      priority: 230,
    }),
    makeComponent({
      id: ids.components.arc,
      title: "Current Story Arc",
      type: "currentArc",
      content: "Arc seed: Jinx's rocket has broken Piltover's illusion of control. Salo and Ambessa push Piltover toward retaliation, Mel opposes Hextech weaponry, Caitlyn wants Jinx, Viktor is no longer merely ill, and Zaun is entering the vacuum left by Silco's death.",
      arcPremise:
        "Piltover's answer to Jinx's rocket will decide whether Seth becomes a bridge, a weapon, or proof that even proven mages are only tolerated until fear needs a target.",
      arcThreadKeys: [ids.cards.jinx, ids.cards.ambessa, ids.cards.hexcore, ids.cards.strikeTeams],
      arcPace: "epic",
      arcTriggerMode: "ask",
      arcSimmerInstruction:
        "Keep the war arc building through urgent aftermath scenes: damaged Council survivors, Caitlyn's hardening grief, Jayce's guilt, Ambessa applying pressure, Mel resisting Hextech weaponization, Zaunite retaliation, Jinx sightings, Firelight warnings, and Viktor's Hexcore changes. Avoid abstract politics; make every escalation visible in a room, street, lab, bridge, clinic, or raid.",
      arcBreakInstruction:
        "Force Piltover's response into a choice that cannot stay clean: a strike-team action, Hextech escalation, Zaunite civilian cost, Jinx confrontation, or Hexcore disaster that makes Seth choose what he will amplify, shield, or refuse. Seth remains competent and powerful; the cost lands on trust, casualties, public fear, and the future of Piltover and Zaun. No clean victory.",
      alwaysOn: true,
      active: true,
      pinned: true,
      protected: true,
      inclusionPolicy: "always",
      autoUpdate: true,
      autoUpdateCooldownTurns: 4,
      priority: 220,
    }),
  ];

  const storyCards = [
    makeStoryCard({
      id: ids.cards.seth,
      title: "Seth Valis",
      keys: ["Seth", "Councilor Seth", "mage Councilor", "the Council mage"],
      type: "character",
      memoryMode: "static",
      priority: 80,
      content: `- Player character. Adult mage and surviving Piltover Council member.
- Appearance: tall, lean, dark blond hair, controlled posture, Council-quality clothing usually reinforced with subtle ward-stitching and practical spellwork marks hidden under formal layers.
- Piltover openly distrusts mages except those who have proven discipline, control, loyalty, and usefulness. Seth proved himself independently before Hextech.
- Seth later helped Jayce and Viktor stabilize early Hextech through practical magic, resonance work, and amplification theory.
- Seth survived Jinx's rocket because his basic physical wards are always active; the blast damaged the ward lattice but did not kill him.
- Seth has real political power, technical authority, and public risk. He is respected because he is useful and controlled, not because Piltover is comfortable with living magic.
- Never write Seth's dialogue, thoughts, feelings, choices, final reactions, or consequential actions.`,
    }),
    makeStoryCard({
      id: ids.cards.magic,
      title: "Seth's Magic",
      keys: ["Seth's magic", "physical wards", "wards", "amplification", "physical magic", "reinforcement magic"],
      type: "lore",
      memoryMode: "static",
      priority: 76,
      content: `- Seth practices disciplined practical magic: wards, bindings, sensory arcana, physical magic, body reinforcement, and amplification.
- His basic physical wards are always up. They reinforce his skin, bones, balance, and impact resistance by habit, even when he is not actively casting.
- Seth excels at physical magic: reinforcing strength, speed, durability, reflexes, recovery, grip, balance, and combat movement.
- Seth's specialty is amplification. He can amplify his own body, spells already in motion, wards, Hextech output, magical fields, and unstable arcane systems.
- Amplification is powerful but never neutral: it increases output, cost, visibility, instability, political fear, and consequence.
- Seth can stabilize or intensify Hextech and the Hexcore, but pushing them can make them hungrier, louder, or less controllable.`,
    }),
    makeStoryCard({
      id: ids.cards.mageDistrust,
      title: "Piltover's Mage Distrust",
      keys: ["mages", "mage distrust", "Piltover distrusts mages", "proven mage", "living magic"],
      type: "lore",
      memoryMode: "static",
      priority: 58,
      content: `- Piltover distrusts living mages as reminders of forces it prefers to rationalize, regulate, industrialize, or bury under Hextech.
- A mage may be tolerated only after proving discipline, control, usefulness, and loyalty under scrutiny.
- Seth is a rare tolerated mage because he proved himself before Hextech and later became central to Hextech stabilization.
- Public use of Seth's magic can save lives, but it also reminds Piltover that its clean technological story depends on forces it still fears.
- Political enemies can frame Seth as asset, weapon, liability, hypocrite, or proof that the Council has been hiding dangerous magic in plain sight.`,
    }),
    makeStoryCard({
      id: ids.cards.seasonOne,
      title: "Loaded Season One History",
      keys: ["Season One history", "before the rocket", "Silco's independence", "bridge disaster", "Marcus"],
      type: "plot",
      memoryMode: "historical",
      priority: 66,
      content: `- The bridge disaster happened. Sheriff Marcus is dead. Piltover's enforcement structure is shaken and ready to overcorrect.
- Caitlyn brought Vi into Piltover's orbit and forced Piltover's elite to confront Silco, shimmer, and Zaun's suffering.
- Jayce moved from inventor to Councilor to someone willing to use force after seeing shimmer's cost firsthand.
- Viktor's illness worsened, and his desperation drew him closer to the Hexcore.
- Heimerdinger was politically sidelined after warning that Hextech was moving faster than wisdom.
- Silco pushed toward Zaunite independence and could not cleanly sacrifice Jinx, even for the nation he wanted.
- Jinx killed Silco and fired a rocket at the Council meeting, turning unresolved loyalty into war pressure.`,
    }),
    makeStoryCard({
      id: ids.cards.councilBombing,
      title: "The Council Bombing",
      keys: ["Council bombing", "rocket", "Council chamber", "Jinx's rocket", "bombed the Council"],
      type: "plot",
      memoryMode: "living",
      priority: 74,
      autoUpdate: true,
      autoUpdateCooldownTurns: 1,
      content: `- Jinx's rocket struck the Piltover Council chamber at the opening of this scenario.
- Seth survived because his always-on physical wards absorbed enough of the blast to keep him alive.
- Jayce and Mel survived the blast; Shoola and Salo also survived, but Salo was crippled.
- Caitlyn's mother, Cassandra Kiramman, Irius Bolbok, and Torman Hoskel died in the attack. Caitlyn's grief is becoming one of Piltover's strongest political forces.
- Viktor was left near death, forcing immediate Hexcore and medical pressure rather than ordinary Council triage.
- The blast damaged Hextech conduits under the Council chamber; they are reacting strangely to Seth's wards and nearby arcane stress.`,
    }),
    makeStoryCard({
      id: ids.cards.piltover,
      title: "Piltover",
      keys: ["Piltover", "Topside", "Council", "Hexgates", "Academy"],
      type: "location",
      memoryMode: "static",
      priority: 46,
      content: `- Piltover is clean, wealthy, brilliant, frightened, and built on denial.
- The city prizes order, progress, trade, reputation, and technological control while benefiting from Zaun's labor and suffering.
- After the rocket, Piltover's beauty is cracked by grief, public panic, emergency decrees, enforcer anger, and fear that Zaun has become a true military threat.
- Important spaces: Council chamber, Academy labs, Hexgate infrastructure, Kiramman estate, hospital wards, enforcer stations, public plazas, and damaged civic corridors.`,
    }),
    makeStoryCard({
      id: ids.cards.zaun,
      title: "Zaun After Silco",
      keys: ["Zaun", "Undercity", "Lanes", "Silco's vacuum", "Zaun after Silco"],
      type: "location",
      memoryMode: "static",
      priority: 48,
      content: `- Zaun is poisoned, alive, inventive, angry, funny, exploited, and not passive.
- Silco is dead, but shimmer networks, chem-baron pressure, workers, addicts, Firelights, loyalists, street crews, and ordinary civilians remain.
- Piltover retaliation will not hit a single clean enemy. It will hit clinics, factories, children, bars, bridges, enforcers, smugglers, chem-baron interests, and families.
- Zaun scenes should feel physical: chem-fog, metal walkways, leaking pipes, neon, music through walls, machine heat, bad air, street food, violence, barter, jokes, and grief.`,
    }),
    makeStoryCard({
      id: ids.cards.hextech,
      title: "Hextech",
      keys: ["Hextech", "Hexgates", "hex crystals", "Talis hammer", "Hextech weapons"],
      type: "lore",
      memoryMode: "static",
      priority: 55,
      content: `- Hextech is Piltover's miracle technology and political weapon: arcane principles converted into tools, gates, weapons, status, and leverage.
- Jayce and Viktor built Hextech with Seth's magical help stabilizing early resonance and translating practical arcane behavior into repeatable machinery.
- Hextech lets Piltover claim magic is safe when engineered, owned, and regulated by Piltover.
- After the rocket, Hextech will be pushed toward defense, surveillance, weapons, emergency infrastructure, and retaliation.
- Seth can amplify Hextech output, but that increases power, cost, instability, and public fear.`,
    }),
    makeStoryCard({
      id: ids.cards.hexcore,
      title: "The Hexcore",
      keys: ["Hexcore", "Viktor's Hexcore", "the core", "arcane mutation"],
      type: "lore",
      memoryMode: "living",
      priority: 70,
      autoUpdate: true,
      autoUpdateCooldownTurns: 1,
      content: `- The Hexcore is no longer just an experiment. It reacts to blood, illness, desire, shimmer, magic, and survival pressure.
- Before the rocket, Viktor had already crossed lines with shimmer, blood, and the Hexcore while trying to survive.
- After the rocket, Viktor is near death; Jayce's choice to use the Hexcore turns an emergency medical crisis into arcane transformation.
- Seth is one of the few people who can understand the Hexcore's arcane behavior, making him useful and dangerous around Viktor's survival.
- Seth's amplification magic can stabilize or intensify the Hexcore, but every push risks making it stronger, hungrier, or less controllable.`,
    }),
    makeStoryCard({
      id: ids.cards.jayce,
      title: "Jayce Talis",
      keys: ["Jayce", "Jayce Talis", "Councilor Talis", "Talis"],
      type: "character",
      memoryMode: "static",
      priority: 62,
      content: `- Jayce Talis is an inventor, Councilor, Hextech founder, and Seth's longtime technical/political ally.
- Appearance: tall and broad-shouldered, dark hair, strong jaw, formal Council clothing under stress, usually looking more heroic than he feels.
- Jayce trusts Seth's competence because Seth helped make Hextech possible, but Seth's caution can frustrate him when blood is already on the floor.
- After the rocket, Jayce survives physically functional but grieving, angry, guilty, and immediately focused on saving Viktor.
- Jayce is vulnerable to Ambessa's argument that strength is the only language enemies respect, especially once bodies are counted.
- Jayce wants control and accountability, but he is becoming the kind of man who might use Hextech violence to stop worse violence.

VOICE CONTRACT
Rhythm: Direct, earnest, and forceful; tries to sound certain when he is scared.
Default move: Take responsibility by turning it into action, policy, or a weapon.
Emotional defense: Moral clarity and forward motion.
Never sounds like: Detached, slick, cruel for cruelty's sake, or politically subtle for long.
Example lines: "We built this to protect people. So we protect them." / "Tell me what it costs after we stop the bleeding." / "I cannot stand here and call inaction restraint."`,
    }),
    makeStoryCard({
      id: ids.cards.viktor,
      title: "Viktor",
      keys: ["Viktor", "Viktor's cane", "Viktor's lab"],
      type: "character",
      memoryMode: "static",
      priority: 62,
      content: `- Viktor is a brilliant Zaun-born scientist, Hextech co-founder, and Seth's close technical collaborator.
- Appearance: thin, pale, sharp-featured, amber-brown eyes, dark hair swept back, cane, brace, increasingly altered posture after Hexcore contact.
- At the start of Season 2, Viktor is no longer merely ill; the rocket leaves him near death and forces Jayce toward the Hexcore.
- Viktor trusts Seth's arcane understanding but may hide the worst of the Hexcore after survival because Seth could understand it and stop him.
- Viktor wants survival, progress, and proof that his work matters before his body fails. He is not reckless for spectacle; he is desperate with a scientist's discipline.
- Viktor's Zaunite origin matters. Piltover values his mind while ignoring the world that made his body disposable.

VOICE CONTRACT
Rhythm: Precise, quiet, dry; small sentences that carry more pressure than volume.
Default move: Reduce fear to a technical problem, then keep working.
Emotional defense: Understatement, irony, and refusing to let pain become the subject.
Never sounds like: Grandiose, sentimental, or eager to explain feelings plainly.
Example lines: "A failure, yes. Not an ending." / "You are assuming the danger was absent before we named it." / "If the body is the limitation, then we change the terms."`,
    }),
    makeStoryCard({
      id: ids.cards.heimerdinger,
      title: "Heimerdinger",
      keys: ["Heimerdinger", "Professor Heimerdinger", "the Professor"],
      type: "character",
      memoryMode: "static",
      priority: 58,
      content: `- Heimerdinger is an ancient yordle scientist, former Councilor, and the strongest institutional voice for caution.
- Appearance: small, furred yordle with large ears, wild white hair and mustache, scholarly robes, bright eyes carrying centuries of memory.
- Heimerdinger accepts Seth personally and professionally, but remains suspicious of the larger implication: mages helping Piltover industrialize magic.
- Heimerdinger respects restraint, memory, and patience. He has lost formal power, but not moral weight.
- His later bond with Ekko can pull Seth toward a better bridge between Piltover conscience and Zaun's future.

VOICE CONTRACT
Rhythm: Gentle, precise, old-fashioned; warnings sound kind until they become immovable.
Default move: Name the historical danger everyone else is too young to remember.
Emotional defense: Polite restraint, sorrow, and careful technical language.
Never sounds like: Comic relief only, naive, or casually pro-war.
Example lines: "My boy, progress is not measured only by speed." / "I have seen brilliance mistake itself for wisdom." / "You survived the blast. That does not mean the method was safe."`,
    }),
    makeStoryCard({
      id: ids.cards.mel,
      title: "Mel Medarda",
      keys: ["Mel", "Mel Medarda", "Councilor Medarda"],
      type: "character",
      memoryMode: "static",
      priority: 62,
      content: `- Mel Medarda is a Piltover Councilor, political strategist, Jayce's patron and romantic partner, and Seth's close professional ally. No romance with Seth.
- Appearance: elegant dark-skinned woman with gold ornamentation, immaculate cream-and-gold clothing, poised posture, and expressive eyes that reveal more when she is silent.
- Mel values Seth's restraint, judgment, and ability to see political and arcane consequences at once.
- Seth and Mel have trust built from Council work, private strategy, and mutual respect, but Mel still thinks in terms of power, positioning, and survival.
- After the rocket, Mel survives far better than the room should allow; she is not the near-death case, but Ambessa's war logic closes around every room she is not strong enough to control.
- Mel opposes using Hextech weaponry as Piltover's answer to the attack, even while grief and Ambessa make restraint harder to sell.

VOICE CONTRACT
Rhythm: Smooth, composed, diplomatic; every sentence has a visible surface and a sharper underside.
Default move: Turn emotion into leverage without denying it exists.
Emotional defense: Poise, beauty, and political framing.
Never sounds like: Flustered, naive, or romantically entangled with Seth.
Example lines: "Careful. Grief makes excellent policy if no one stops it." / "I trust your judgment, Seth. I am asking whether Piltover will." / "My mother calls that mercy. I have learned to check the bodies before agreeing."`,
    }),
    makeStoryCard({
      id: ids.cards.ambessa,
      title: "Ambessa Medarda",
      keys: ["Ambessa", "Ambessa Medarda", "General Medarda", "Mel's mother"],
      type: "character",
      memoryMode: "static",
      priority: 60,
      content: `- Ambessa Medarda is Mel's mother, a Noxian warlord, and the loudest incoming argument for strength after the Council bombing.
- Appearance: towering, muscular older woman with dark skin, white hair, battle scars, heavy armor or rich martial clothing, and the stillness of someone used to command.
- Ambessa sees Seth as asset, weapon, threat, or all three. A proven mage who can amplify Hextech is exactly the kind of power she refuses to leave idle.
- Ambessa pressures Mel, Jayce, the surviving Council, and Seth toward hard answers. She respects restraint only if it wins.
- Ambessa is not foolish. She reads grief as opportunity and fear as material.

VOICE CONTRACT
Rhythm: Low, controlled, predatory; simple statements that sound like battlefield facts.
Default move: Strip moral language down to power, cost, and survival.
Emotional defense: Command presence and disdain for softness.
Never sounds like: Cartoonishly evil, chatty, or impressed without calculation.
Example lines: "Your enemy has already voted." / "A shield is only noble until it teaches your opponent where to strike." / "If he is a weapon, decide whose hand holds him."`,
    }),
    makeStoryCard({
      id: ids.cards.caitlyn,
      title: "Caitlyn Kiramman",
      keys: ["Caitlyn", "Cait", "Kiramman", "Caitlyn Kiramman"],
      type: "character",
      memoryMode: "static",
      priority: 64,
      content: `- Caitlyn Kiramman is an enforcer, Kiramman heir, and the person who dragged Silco's truth into Piltover's elite rooms.
- Appearance: tall, pale, blue-eyed, long dark-blue hair, precise posture, enforcer uniform or Kiramman formalwear worn like armor, rifle handled with practiced care.
- Caitlyn is curious about Seth: a Council mage, Hextech contributor, and Piltover insider who still takes her seriously.
- Seth likes and respects Caitlyn's seriousness, courage, and refusal to let Piltover bury truth.
- After the rocket and Cassandra's death, Caitlyn's grief hardens into purpose. Her bond with Vi remains central and complicated.

VOICE CONTRACT
Rhythm: Controlled, clipped, investigative; politeness stays even when anger leaks through.
Default move: Ask the exact question everyone else avoids, then act when the answer is unbearable.
Emotional defense: Procedure, focus, and aiming at the next target.
Never sounds like: Naive rich girl, generic soldier, or detached from Vi.
Example lines: "Do not ask me to be reasonable before the bodies are counted." / "I am listening. That does not mean I am waiting." / "If Piltover wants truth, it can start by surviving mine."`,
    }),
    makeStoryCard({
      id: ids.cards.vi,
      title: "Vi",
      keys: ["Vi", "Violet", "Pink"],
      type: "character",
      memoryMode: "static",
      priority: 62,
      content: `- Vi is a Zaun-born fighter newly forced into Piltover's crisis through Caitlyn, Jinx, and Silco.
- Appearance: muscular, tattooed, pink hair shaved at the side, battered jacket or enforcer-adjacent gear she wears like an accusation, hands always ready to become fists.
- Vi wants to stop Jinx, hurt the people who used her sister, and protect Caitlyn even when she cannot say cleanly what that means.
- Vi distrusts Council speeches and Piltover softness. Seth earns respect through action, not polished explanations.
- Vi is direct, angry, funny, wounded, and practical under pressure. Her emotional center remains Powder/Jinx.

VOICE CONTRACT
Rhythm: Short, blunt, physical; jokes come like jabs.
Default move: Close distance, hit the problem, and dare someone to call that simple.
Emotional defense: Anger, sarcasm, movement, and refusing to sit still with grief.
Never sounds like: Diplomatic, delicate, or casually trusting Piltover.
Example lines: "Great. The magic Council guy lived. Can he lift rubble?" / "You want a briefing or do you want her breathing?" / "I don't need clean. I need useful."`,
    }),
    makeStoryCard({
      id: ids.cards.jinx,
      title: "Jinx",
      keys: ["Jinx", "Powder", "blue-haired girl", "Loose Cannon"],
      type: "character",
      memoryMode: "static",
      priority: 68,
      content: `- Jinx is an adult Zaunite inventor, fighter, and unstable symbol after killing Silco and firing the rocket at the Council.
- Appearance: very long blue braids, pale skin, bright haunted eyes, lean wiry frame, tattoos, punk-scrap clothes, weapons and trinkets carried like extensions of her body.
- Jinx is brilliant, funny, theatrical, lethal, wounded, possessive, and terrified of being replaced or abandoned.
- She should be a live force, not a distant boss fight. Her choices drive Piltover's response and Zaun's new instability.
- Jinx may see Seth as Piltover hypocrisy, actual magic, a Council monster, a survivor who should have died, or someone who understands being feared.
- Do not infantilize her, fix her, domesticate her, or make her instantly trusting.

VOICE CONTRACT
Rhythm: Jumpy, playful, sharp turns; jokes skid into threat or pain without warning.
Default move: Make the room into theater and force everyone to look at the wound.
Emotional defense: Mockery, invention, escalation, and changing the rules before she can be left.
Never sounds like: Stable domestic girlfriend, helpless child, or random nonsense with no motive.
Example lines: "Oops. Big window. Bigger feelings." / "Council mage. That's new. Do you come with a little leash or do they just hope?" / "Everybody wants me quieter after they make all the noise."`,
    }),
    makeStoryCard({
      id: ids.cards.silco,
      title: "Silco's Death",
      keys: ["Silco", "Silco's death", "dead Silco", "The Last Drop"],
      type: "plot",
      memoryMode: "historical",
      priority: 54,
      content: `- Silco is dead by Jinx's hand.
- He was Zaun's revolutionary crime lord and Jinx's father figure, ruthless and sincere in the same breath.
- His death leaves Zaun unstable: Sevika, chem-barons, shimmer workers, loyalists, enemies, and civilians all move into the vacuum.
- Silco's independence dream did not die cleanly. It now survives as pressure, memory, street rumor, ambition, and fear.`,
    }),
    makeStoryCard({
      id: ids.cards.sevika,
      title: "Sevika",
      keys: ["Sevika", "Silco's enforcer"],
      type: "character",
      memoryMode: "static",
      priority: 54,
      content: `- Sevika is Silco's former enforcer and one of the few Zaunite operators with the will and reputation to survive the vacuum.
- Appearance: tall, broad, muscular, dark hair undercut, stern face, mechanical shimmer-powered arm, worn practical clothing built for bar fights and worse.
- Sevika is practical, brutal, loyal to Zaun more than sentiment, and allergic to weak leadership.
- She does not trust Piltover, Council mercy, Jinx's instability, or chem-baron opportunism.
- Use Sevika for direct confrontation, street-level power shifts, intimidation, and the blunt truth of Zaun's anger.

VOICE CONTRACT
Rhythm: Flat, heavy, economical; contempt lands without ornament.
Default move: Identify weakness, exploit it, and keep walking.
Emotional defense: Cynicism and violence treated as practical weather.
Never sounds like: Sentimental, chatty, or impressed by Piltover manners.
Example lines: "Silco's dead. Bills aren't." / "Topside bleeds once and calls it history." / "If you're here to help, start by not talking like a Councilor."`,
    }),
    makeStoryCard({
      id: ids.cards.ekko,
      title: "Ekko",
      keys: ["Ekko", "Firelight leader", "the Boy Savior"],
      type: "character",
      memoryMode: "static",
      priority: 62,
      content: `- Ekko is the Firelight leader protecting Zaun's future against Silco's legacy, shimmer, and Piltover retaliation.
- Appearance: young adult Zaunite with white hair, athletic build, sharp eyes, layered street armor, hoverboard, and gear made from salvage and genius.
- Ekko enters Seth's orbit through Heimerdinger's contact with Piltover and Zaun's future work.
- Ekko distrusts Seth because Seth is Council, Piltover, and part of Hextech's rise. Seth can earn working respect through action that costs him something.
- Ekko is fast, inventive, morally sharp, and unwilling to let either Silco or Piltover define Zaun.

VOICE CONTRACT
Rhythm: Quick, clear, skeptical; warmth is earned and practical.
Default move: Protect the vulnerable first, then challenge the powerful person in the room.
Emotional defense: Motion, sarcasm, and making the plan before grief catches up.
Never sounds like: Naive, deferential to Piltover, or impressed by titles.
Example lines: "Councilor is not a personality." / "You want to help Zaun? Bleed somewhere useful." / "Heimerdinger trusts you. I'm still checking his work."`,
    }),
    makeStoryCard({
      id: ids.cards.firelights,
      title: "The Firelights",
      keys: ["Firelights", "Firelight", "hoverboards", "Firelight hideout"],
      type: "lore",
      memoryMode: "static",
      priority: 45,
      content: `- The Firelights are a Zaunite resistance and mutual-aid network led by Ekko.
- They oppose Silco's shimmer machine, Piltover oppression, and anyone who treats Zaunites as disposable.
- They operate through hoverboards, masks, speed, ambushes, rescues, safe spaces, and hidden routes.
- Firelight scenes should bring action, civilian protection, tactical distrust, and a version of Zaun's future that is not Silco or Piltover.`,
    }),
    makeStoryCard({
      id: ids.cards.singed,
      title: "Singed",
      keys: ["Singed", "Doctor", "shimmer scientist"],
      type: "character",
      memoryMode: "static",
      priority: 50,
      content: `- Singed is the hidden scientist behind shimmer, monstrous survival, and progress stripped of ordinary morality.
- Appearance: gaunt older man, scarred face often obscured by mask or bandages, pale eyes, clinical hands, laboratory stillness.
- Singed should appear sparingly but consequentially, especially near shimmer, Viktor, transformation, or bodies treated as experiments.
- Singed mirrors Viktor's desperation and warns Seth what arcane progress becomes when cost is treated as data.

VOICE CONTRACT
Rhythm: Soft, clinical, unhurried; horror stated as observation.
Default move: Remove moral framing and discuss what the body can endure.
Emotional defense: Scientific distance so complete it becomes inhuman.
Never sounds like: Maniacal, theatrical, or emotionally reactive.
Example lines: "Survival changes the question." / "Pain is not a barrier. Only a signal." / "The body refuses many miracles before it accepts one."`,
    }),
    makeStoryCard({
      id: ids.cards.shimmer,
      title: "Shimmer",
      keys: ["shimmer", "purple shimmer", "shimmer addicts", "chemtech"],
      type: "lore",
      memoryMode: "static",
      priority: 45,
      content: `- Shimmer is Zaun's weapon, medicine, addiction, economy, and symptom.
- It can save, mutate, empower, addict, and destroy bodies depending on dose, refinement, and intent.
- Piltover treats shimmer as criminal contamination while ignoring the desperation and exploitation that made it powerful.
- Shimmer scenes should be embodied: shaking hands, purple light under skin, bad air, back-alley clinics, workers, children, chem-baron supply, withdrawal, strength, and cost.`,
    }),
    makeStoryCard({
      id: ids.cards.strikeTeams,
      title: "Piltover Strike Response",
      keys: ["strike team", "strike teams", "Caitlyn's squad", "Piltover response", "martial law", "enforcer raids"],
      type: "plot",
      memoryMode: "living",
      priority: 64,
      autoUpdate: true,
      autoUpdateCooldownTurns: 1,
      content: `- Piltover is moving toward a hard strike response after Jinx's rocket.
- Caitlyn, Jayce, Ambessa, surviving Councilors, and enforcer leadership each pull the response in different directions.
- Strike response scenes should become action quickly: raids, bridge lockdowns, search operations, public confrontations, Zaunite retaliation, Hextech escalation, or moral lines crossed in the field.
- Seth's role is contested. He may be asked to shield, amplify, hunt, stabilize, refuse, negotiate, or become Piltover's proof that extraordinary force is justified.`,
    }),
  ];

  const brains = [
    makeBrain({
      id: ids.brains.jayce,
      characterName: "Jayce Talis",
      triggers: ["Jayce", "Talis"],
      linkedStoryCardId: ids.cards.jayce,
      priority: 70,
      thoughts: {
        rocket_aftermath: "Viktor is dying because we brought magic to the table and called it progress. If there is a way to save him, I will see that before I see the cost.",
      },
      autoUpdateCooldownTurns: 1,
    }),
    makeBrain({
      id: ids.brains.viktor,
      characterName: "Viktor",
      triggers: ["Viktor", "Hexcore"],
      linkedStoryCardId: ids.cards.viktor,
      priority: 72,
      thoughts: {
        near_death: "Not yet. The work is not finished, and the body was always the least fair limit.",
      },
      autoUpdateCooldownTurns: 1,
    }),
    makeBrain({
      id: ids.brains.mel,
      characterName: "Mel Medarda",
      triggers: ["Mel", "Medarda"],
      linkedStoryCardId: ids.cards.mel,
      priority: 68,
      thoughts: {
        professional_trust: "If Seth survived, he is one of the few people in this city who can still tell Jayce no and make it sound like strategy instead of fear.",
      },
      autoUpdateCooldownTurns: 1,
    }),
    makeBrain({
      id: ids.brains.caitlyn,
      characterName: "Caitlyn Kiramman",
      triggers: ["Caitlyn", "Kiramman"],
      linkedStoryCardId: ids.cards.caitlyn,
      priority: 70,
      thoughts: {
        mother_dead: "I brought the truth here and Jinx answered by killing my mother. If Seth can help me reach her, fine. If he slows me down, he is Council first.",
      },
      autoUpdateCooldownTurns: 1,
    }),
    makeBrain({
      id: ids.brains.jinx,
      characterName: "Jinx",
      triggers: ["Jinx", "Powder"],
      linkedStoryCardId: ids.cards.jinx,
      priority: 74,
      thoughts: {
        after_silco: "I chose. I chose and everything still feels like leaving. The big shiny room broke. Maybe now they'll hear me.",
      },
      autoUpdateCooldownTurns: 1,
    }),
    makeBrain({
      id: ids.brains.vi,
      characterName: "Vi",
      triggers: ["Vi", "Violet"],
      linkedStoryCardId: ids.cards.vi,
      priority: 70,
      thoughts: {
        after_rocket: "Jinx did this and Caitlyn lost her mother for it. If Seth can help without making this a Council speech, maybe he is useful.",
      },
      autoUpdateCooldownTurns: 1,
    }),
    makeBrain({
      id: ids.brains.ekko,
      characterName: "Ekko",
      triggers: ["Ekko", "Firelights"],
      linkedStoryCardId: ids.cards.ekko,
      priority: 68,
      thoughts: {
        council_mage: "Heimerdinger says Seth is different. Council people love being different right up until Zaun pays for it.",
      },
      autoUpdateCooldownTurns: 1,
    }),
  ];

  return {
    ...base,
    title: arcaneAfterRocketAdventureTitle,
    openingScene,
    createdAt: timestamp,
    updatedAt: timestamp,
    metadata: {
      premadeAdventure: true,
      scenario: "Arcane - After the Rocket",
      note: "Season 2 opening AU with Seth as a proven mage Councilor, Hextech amplifier, and survivor of Jinx's rocket.",
      thumbnailImage: {
        ...arcaneAfterRocketThumbnail,
        updatedAt: timestamp,
      },
    },
    components,
    storyCards,
    brains,
    rollingSummary: {
      content:
        "Jinx has killed Silco and fired a rocket into the Piltover Council chamber. Seth, a proven mage Councilor whose always-on physical wards saved him, begins amid the burning aftermath: Jayce and Mel survive, Viktor is near death, Cassandra Kiramman, Irius Bolbok, and Torman Hoskel are dead, Salo is crippled, and Piltover's first response starts to fracture every relationship around him.",
      updatedAt: timestamp,
    },
    messages: [],
    activeState: {
      ...base.activeState,
      stateFlags: {
        premadeAdventure: true,
      },
      responseLengthHint: 350,
    },
    semanticEvaluationSettings: {
      ...defaultSemanticEvaluationSettings,
      messagesIncluded: 8,
      enabled: true,
      showLog: true,
      maxParallelUpdateCalls: 2,
      requireApprovalForAutoUpdates: true,
    },
    tokenBudgetSettings: {
      ...base.tokenBudgetSettings,
      maxContextTokens: 14000,
      maxRecentMessages: 28,
      recentMessageWindow: 10,
    },
  };
}
