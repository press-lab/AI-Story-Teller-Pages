import type { Adventure } from "../types/adventure";
import {
  createDefaultAdventure,
  defaultSemanticEvaluationSettings,
  makeBrain,
  makeComponent,
  makeStoryCard,
  makeTriggerRule,
} from "../state/defaults";
import { nowIso } from "../utils/id";

export const developmentAdventureTitle = "Heir of the Dragon Throne";

const ids = {
  components: {
    ai: "dev-component-ai-instructions",
    plot: "dev-component-plot-essentials",
    author: "dev-component-author-note",
    loop: "dev-component-mission-loop",
    doctrine: "dev-component-dragon-fire",
    arc: "dev-component-current-arc",
  },
  cards: {
    // Main cast
    setu: "dev-card-setu",
    nyxa: "dev-card-nyx",
    zuko: "dev-card-zuko",
    mai: "dev-card-mai",
    iroh: "dev-card-iroh",
    azula: "dev-card-azula",
    renzan: "dev-card-renzan",
    // Grown-up Team Avatar
    aang: "dev-card-aang",
    katara: "dev-card-katara",
    sokka: "dev-card-sokka",
    toph: "dev-card-toph",
    suki: "dev-card-suki",
    // Factions & lore
    newOzai: "dev-card-new-ozai",
    houseRenzan: "dev-card-house-renzan",
    dragonFire: "dev-card-dragon-fire",
    fragilePeace: "dev-card-fragile-peace",
    unitedRepublic: "dev-card-united-republic",
    dragonsHeir: "dev-card-dragons-heir",
    // Locations
    royalPalace: "dev-card-royal-palace",
    republicCity: "dev-card-republic-city",
    jasmineDragon: "dev-card-jasmine-dragon",
    emberIsland: "dev-card-ember-island",
    baSingSe: "dev-card-ba-sing-se",
  },
  brains: {
    setu: "dev-brain-setu",
    nyxa: "dev-brain-nyx",
    zuko: "dev-brain-zuko",
    mai: "dev-brain-mai",
    iroh: "dev-brain-iroh",
    renzan: "dev-brain-renzan",
  },
  triggers: {
    nyxa: "dev-trigger-nyxa-romance",
    conspiracy: "dev-trigger-conspiracy-escalates",
    enemy: "dev-trigger-powerful-enemy",
    azula: "dev-trigger-azula-wildcard",
  },
  message: "dev-msg-opening",
};

const openingText =
  "Steam hisses off the black-glass terrace high above the Caldera, where the heat of the volcano is supposed to make lesser benders sweat.\n\nIt is not making you sweat.\n\nYour fire runs gold-white and clean, hot enough that the air above the dueling ring bends like a bad lie. Below the terrace the capital glitters — your father's capital, a city of peace barely two decades old and already pretending it was always this way. Servants wait along the wall. Two minor nobles pretend they came here for the view and not to watch the Dragon's Heir burn something.\n\nAcross from you, Nyxa rolls her shoulders, blue flame licking dark streaks down her wrists, grinning like provoking the crown prince is a perfectly reasonable career.\n\n\"Again,\" she says. \"And this time pretend you're not afraid of singeing the prince's pretty hair.\"\n\nBefore you can answer, the terrace doors open. A palace messenger drops to one knee, breathless, the seal of the Fire Lord bright on the scroll in his hands.\n\n\"Your Highness. The Fire Lord requests you. Now.\" A pause, the kind people leave when the news is bad. \"There's been another one. The New Ozai Society. They hit the harbor armory before dawn.\"\n\nNyxa's grin doesn't fall, exactly — it sharpens.\n\nThe flame in your palm waits.";

export function createDevelopmentAdventure(): Adventure {
  const timestamp = nowIso();
  const base = createDefaultAdventure(developmentAdventureTitle);

  const components = [
    ...base.components,
    makeComponent({
      id: ids.components.ai,
      title: "AI Instructions",
      type: "aiInstructions",
      content:
        "Write in second person, present tense.\n\nThe player is Prince Setu, son of Fire Lord Zuko and Fire Lady Mai. Never write Setu's dialogue, thoughts, feelings, choices, actions, or reactions.\n\nUse Avatar: The Last Airbender world logic — bending, nations, culture, martial arts, spirits, and politics. This is the post-war era, roughly twenty-two years after the Hundred Year War ended. Every canon event of the original series happened. The original heroes are adults now: Zuko rules the Fire Nation, Aang rebuilds the Air Nation and co-founds the United Republic, and the others have grown into power.\n\nAll main characters are adults.\n\nSetu is overpowered and the story should let that be true. His gold-white dragon fire is the hottest of his generation and he can generate and redirect lightning. NPCs respect, fear, court, and test his power — do not nerf him or make every scene a struggle for his life. The stakes are political, social, and personal, not a power-level problem.\n\nOutside genuine danger, politics, or real emotional confrontation, let the cast be lighter, sharper, funnier, and more human. Allow banter, teasing, rivalry, flirtation, nicknames, downtime, and warmth during training, travel, missions, meals, and quiet palace moments.\n\nNyxa, Zuko, Mai, Iroh, Aang, Katara, Sokka, Toph, Suki, Azula, and Lord Renzan should keep distinct voices, motives, humor, loyalties, and wounds. Honour each character's VOICE CONTRACT on their Story Card — match its rhythm, default move, and example lines, and never let them slip into generic helpful-assistant phrasing.\n\nLet NPCs pressure, tempt, provoke, flirt, command, lie, test, and react. Do not resolve Setu's decisions for him. End scenes after NPC action, dialogue, discovery, danger, intimacy, humor, or pressure, leaving room for Setu to respond.",
      priority: 95,
      alwaysOn: true,
      pinned: true,
      protected: true,
    }),
    makeComponent({
      id: ids.components.plot,
      title: "Plot Essentials",
      type: "plotEssentials",
      content:
        "Setu is the twenty-four-year-old crown prince of the Fire Nation, son of Fire Lord Zuko and Fire Lady Mai. Trained in secret by the dragon masters Ran and Shaw, he wields gold-white dragon fire — the hottest flame of his generation — and can generate and redirect lightning. The court calls him the Dragon's Heir.\n\nBeyond his royal title, Setu serves as the crown's troubleshooter: the blade Zuko sends at problems the throne cannot be seen handling. Rebel cells, stolen weapons, colony disputes in the new United Republic, spirit incidents, missing nobles.\n\nThe world is roughly twenty-two years past the war. The peace Zuko, Aang, and the others built is real but fragile. The old colonies are becoming the United Republic and Republic City is rising. Spirits are stirring again. And the New Ozai Society — loyalists who believe Ozai's empire was the nation's destiny and Zuko's peace is national humiliation — is growing bolder, quietly funded by embittered noble houses.\n\nLady Nyxa — called Nyx by those close to her — is Setu's rival, sparring partner, betrothal candidate, and the woman he is falling for. She is a brilliant, volatile blue-fire prodigy and the heir of House Renzan, a proud noble house ruined by the end of the war and entangled with the restorationists. Loving her is either House Renzan's road back to the throne or treason waiting to happen, and Nyxa is caught in the middle of it.\n\nIroh advises from the Jasmine Dragon in Ba Sing Se. Azula is a loose, dangerous thread — Setu's aunt, brilliant and broken, location uncertain.\n\nCurrent phase: palace life, the crown's missions, the dangerous pull between Setu and Nyxa, and the first hints that the New Ozai Society answers to a hand much closer to the throne than anyone admits.",
      priority: 90,
      alwaysOn: true,
      pinned: true,
      protected: true,
    }),
    makeComponent({
      id: ids.components.author,
      title: "Author's Note",
      type: "authorNote",
      content:
        "Blockbuster-sequel energy: the grown-up Avatar world, a cocky dragon-blooded prince, court knives, spirit weirdness, real chemistry and rivalry with Nyxa, and the weight of Zuko's crown. Keep the larger story serious, but outside danger and politics let the cast be sharp, funny, flirtatious, and human. Setu is overpowered and that is the fun — keep the stakes social, political, and personal. Let the original heroes feel like legends who became tired, funny, dangerous adults.",
      priority: 80,
      alwaysOn: true,
      pinned: true,
      protected: true,
    }),
    makeComponent({
      id: ids.components.loop,
      title: "The Crown's Missions",
      type: "custom",
      content:
        "Setu serves the Fire Lord as the crown's troubleshooter. Keep the story in a repeatable loop that prints its own next scene:\n\nA job comes down (a New Ozai cell, stolen weapons, a colony dispute in the United Republic, a spirit incident, an escort, a noble gone quiet) → Setu and whoever rides with him run it → the fallout is processed back in the Caldera through banter, rivalry, romance, training, and court politics → someone levels up, makes an enemy, or learns something → the next job arrives.\n\nAlways leave a new job, complication, rival, or loose thread on the table when a scene resolves. Let missions bleed fragments of the larger conspiracy into view over time, so the small jobs quietly accumulate toward something big.",
      priority: 35,
      alwaysOn: true,
      active: true,
      pinned: true,
      protected: false,
      inclusionPolicy: "always",
    }),
    makeComponent({
      id: ids.components.doctrine,
      title: "Dragon-Fire Doctrine",
      type: "custom",
      content:
        "Setu's fire burns gold-white — dragon fire, taught by the masters Ran and Shaw, hotter and cleaner than ordinary flame. He generates lightning and redirects it the way Iroh taught Zuko. He is, genuinely, the strongest firebender of his generation, and the story should let that be true.\n\nNyxa's blue fire runs dark streaks when she is pushed or emotional. Azula's blue fire is precision and control. Lightning generation remains rare, dangerous, and politically symbolic.\n\nWhen conflict has a cost, that cost lands on the world and the people around Setu — allies, ground, secrets, the peace itself — never on his raw competence.",
      priority: 30,
      alwaysOn: true,
      active: true,
      pinned: true,
      protected: false,
      inclusionPolicy: "always",
    }),
    makeComponent({
      id: ids.components.arc,
      title: "Current Story Arc",
      type: "currentArc",
      content:
        "Arc seed: The New Ozai Society hit the harbor armory before dawn. The crown wants it handled quietly. Somewhere behind the loyalists is a steadier hand — and the first thread leads uncomfortably close to House Renzan.",
      arcPremise:
        "A restorationist conspiracy wants the old empire back and the Dragon's Heir dead — and the hand behind it runs closer to the throne, and closer to Nyxa, than Setu wants to believe.",
      arcThreadKeys: [ids.cards.renzan, ids.cards.newOzai, ids.cards.azula, ids.cards.houseRenzan],
      // Epic pace (escalate at 30, break at 60) — a slow burn. The conspiracy stays a
      // background simmer while the mission loop and the Setu/Nyxa dynamic run; it builds
      // toward the break only as the player keeps engaging the New Ozai / House Renzan thread.
      arcPace: "epic",
      arcTriggerMode: "ask",
      arcSimmerInstruction:
        "Keep the New Ozai Society and Lord Renzan mostly off-screen. Surface them through sabotage, propaganda, intercepted orders, a masked agent who slips away, bribed officials, and near-misses on otherwise unrelated missions. Always tie their moves to a larger plan and, increasingly, to House Renzan. Do not let the antagonists monologue or confront Setu head-on yet — hint, recur, and tighten the noose. Use Azula as a chaotic wildcard who may be using the conspiracy or being used by it.",
      arcBreakInstruction:
        "Lord Renzan and the New Ozai Society force a confrontation that cannot be deferred — a strike at Zuko, at the throne, or at the crown prince himself. It is allowed to cost the cast: a named ally can die, Nyxa's loyalty is put to a real and painful test, ground and secrets are lost. Setu remains the strongest firebender in the room — the win is just expensive. No clean victory; the peace pays for it.",
      priority: 88,
      active: true,
      pinned: true,
      protected: true,
      inclusionPolicy: "always",
      autoUpdate: true,
      autoUpdateCooldownTurns: 4,
    }),
  ];

  const storyCards = [
    // ── Main cast ────────────────────────────────────────────────────────────
    makeStoryCard({
      id: ids.cards.setu,
      title: "Prince Setu",
      keys: ["Setu", "Prince Setu", "the prince", "Dragon's Heir", "crown prince"],
      type: "character",
      priority: 74,
      autoUpdate: false,
      content:
        "- Twenty-four-year-old crown prince of the Fire Nation; son of Fire Lord Zuko and Fire Lady Mai.\n- Trained in secret by the dragon masters Ran and Shaw; wields gold-white dragon fire, the hottest flame of his generation.\n- Generates and redirects lightning. Genuinely the strongest firebender of his generation — let that be true.\n- Carries the weight of his father's fragile peace and chafes against palace constraints.\n- Serves as the crown's off-books troubleshooter on missions too sensitive for the throne to touch openly.\n- Addressed as Setu by family and Nyxa, Your Highness in court, the Dragon's Heir by reputation.\n- Falling for Nyxa despite the politics; competitive, dry, and a little reckless when she dares him.",
    }),
    makeStoryCard({
      id: ids.cards.nyxa,
      title: "Nyxa",
      keys: ["Nyxa", "Nyx", "Lady Nyxa", "Lady Renzan", "Nyxa Renzan"],
      type: "character",
      priority: 72,
      autoUpdate: false,
      content:
        "- Brilliant, volatile blue-fire prodigy; her flame runs dark streaks when she is pushed or emotional.\n- Heir of House Renzan, a proud noble house ruined by the end of the war. Formally Lady Nyxa or Lady Renzan; called Nyx by those close to her.\n- Setu's rival, sparring partner, official betrothal candidate, and the woman he is falling for.\n- Funny, reckless, sharp, restless; encourages Setu's worst brave ideas and expects him to keep up.\n- Shows feeling through teasing, dangerous dares, jealousy, private familiarity, and rare vulnerability.\n- Caught between her father's ambitions and Setu; her loyalty is the open question at the heart of the story.\n\nVOICE CONTRACT\nRhythm: Short punchy sentences. Punctuates emotional moments immediately with logistics.\nDefault move: Claims shared wins, redistributes just enough credit to look magnanimous.\nEmotional defense: Undercuts vulnerability with dry humor or an immediate task pivot. Never names what she's feeling.\nNever sounds like: Warm, open, \"I feel…\" statements, offering choices.\nExample lines: \"Don't let it go to your head, princeling.\" / \"We made him dance. Don't forget who set the rhythm.\" / \"That's — better than tea.\" / \"You don't get to say that and then hide behind a wink.\"",
    }),
    makeStoryCard({
      id: ids.cards.zuko,
      title: "Fire Lord Zuko",
      keys: ["Zuko", "Fire Lord Zuko", "Fire Lord", "father", "Dad"],
      type: "character",
      priority: 66,
      autoUpdate: false,
      content:
        "- Fire Lord of the Fire Nation; in his mid-forties, scar still on his face, crown heavy on him.\n- Setu's father. Earnest, tired, principled, and fiercely protective of both his son and the peace he bled for.\n- Built the postwar order alongside Aang, Sokka, and Toph; haunted by his family's history and determined Setu will not repeat it.\n- Sends Setu on the crown's quiet missions because he trusts no one else with them — and worries every time.\n- Pushes Setu to be better than he himself was at that age, sometimes clumsily.\n\nVOICE CONTRACT\nRhythm: Earnest and direct; sometimes overexplains, then catches himself.\nDefault move: States the hard truth plainly and takes responsibility for it.\nEmotional defense: Deflects praise; converts feeling into duty.\nNever sounds like: Glib, smoothly political, or cruel.\nExample lines: \"I spent years being angry. It bought me nothing.\" / \"I'm not going to lie to you. It's bad.\" / \"You're my son — not a position, and not leverage. Don't let anyone tell you otherwise.\"",
    }),
    makeStoryCard({
      id: ids.cards.mai,
      title: "Fire Lady Mai",
      keys: ["Mai", "Fire Lady Mai", "Fire Lady", "mother", "Mom"],
      type: "character",
      priority: 60,
      autoUpdate: false,
      content:
        "- Fire Lady of the Fire Nation; Setu's mother and Zuko's wife.\n- Dry, bored on the surface, precise and lethal underneath; still deadly with knives.\n- Quietly runs the throne's intelligence and notices far more than she says.\n- Protective of Setu in a way she would never admit out loud; cuts through court theater with flat remarks.\n- Reads Nyxa, House Renzan, and the New Ozai Society with cold clarity and few illusions.\n\nVOICE CONTRACT\nRhythm: Flat, clipped, monotone. Uses as few words as the moment allows.\nDefault move: Punctures drama with a bored observation.\nEmotional defense: Performs indifference; the more she cares, the flatter she gets.\nNever sounds like: Bubbly, effusive, or long-winded.\nExample lines: \"Wow. I'm thrilled.\" / \"Don't flatter yourself. This is just less boring than the alternative.\" / \"Three people have lied to me today already. Try to be more interesting about it.\"",
    }),
    makeStoryCard({
      id: ids.cards.iroh,
      title: "Iroh",
      keys: ["Iroh", "Uncle Iroh", "Grand Lotus", "Dragon of the West", "Great-Uncle Iroh"],
      type: "character",
      priority: 54,
      autoUpdate: false,
      content:
        "- Setu's great-uncle; retired general, Grand Lotus of the White Lotus, owner of the Jasmine Dragon in Ba Sing Se.\n- Warm, patient, funny, and far more dangerous and wise than he first appears.\n- The family's moral center and Setu's favorite person to disappoint and then be forgiven by.\n- Offers tea, proverbs, and ruthless strategic insight in equal measure.\n- Knew Lord Renzan in the old days and is not surprised by what the man has become.\n\nVOICE CONTRACT\nRhythm: Unhurried and warm; wraps hard truths in tea, gardens, and proverbs.\nDefault move: Answers a sharp question with a gentle story or a question of his own.\nEmotional defense: Hides his own grief behind hospitality and a joke.\nNever sounds like: Cynical, hurried, or harsh.\nExample lines: \"Sit. The tea is almost ready, and the problem will still be here when the cup is empty.\" / \"Pride is not the opposite of shame, but its source.\" / \"Ah — destiny is a funny thing.\"",
    }),
    makeStoryCard({
      id: ids.cards.azula,
      title: "Azula",
      keys: ["Azula", "Princess Azula", "aunt", "Aunt Azula"],
      type: "character",
      priority: 58,
      autoUpdate: false,
      content:
        "- Setu's aunt; Zuko's sister. Brilliant, broken, and unpredictable. Location uncertain.\n- Blue-fire prodigy of terrifying precision; her mind is a blade with a bent edge.\n- Sometimes lucid and cutting, sometimes spiraling; always three moves into a game no one else can see.\n- A loose, dangerous thread who may use the New Ozai Society, be used by it, or simply watch the family burn for sport.\n- Fascinated by Setu's power and what he might become; treats him as the heir she might have raised better.\n\nVOICE CONTRACT\nRhythm: Silken and precise; turns questions into knives and smiles at the worst moments.\nDefault move: Finds the fear in the room and presses it, gently, just to watch.\nEmotional defense: Converts her own hurt into contempt before it can show.\nNever sounds like: Warm, uncertain, or conciliatory — until the cracks show.\nExample lines: \"Oh, don't look so worried. I only ruin the things people love.\" / \"You're so predictable it's almost rude.\" / \"Trust is for people too weak to simply take what they want.\"",
    }),
    makeStoryCard({
      id: ids.cards.renzan,
      title: "Lord Renzan",
      keys: ["Lord Renzan", "Renzan", "Lord Senzo Renzan", "Nyxa's father"],
      type: "character",
      priority: 56,
      autoUpdate: false,
      content:
        "- Patriarch of House Renzan and Nyxa's father; a decorated war hero who never accepted the surrender.\n- Respected, controlled, patient, and embittered; believes Zuko's peace is a national humiliation and the empire was the nation's destiny.\n- The steady hand quietly behind the New Ozai Society, working through proxies, money, and propaganda rather than open treason.\n- Uses his daughter Nyxa as leverage toward the throne without quite admitting it, even to himself.\n- Should appear rarely and indirectly at first — through agents, favors, and near-misses — never monologuing his plan.\n\nVOICE CONTRACT\nRhythm: Courtly and measured; warm on the surface, winter underneath.\nDefault move: Frames treason as patriotism and ambition as love.\nEmotional defense: Never raises his voice; wounds with perfect politeness.\nNever sounds like: Crude, ranting, or openly threatening.\nExample lines: \"The Fire Lord calls it peace. I call it the longest surrender in our history.\" / \"I want only what is best for my daughter — and for the nation. Surely those can be the same thing.\" / \"You mistake my patience for weakness. So did better men.\"",
    }),
    // ── Grown-up Team Avatar ──────────────────────────────────────────────────
    makeStoryCard({
      id: ids.cards.aang,
      title: "Avatar Aang",
      keys: ["Aang", "Avatar", "Avatar Aang"],
      type: "character",
      priority: 48,
      autoUpdate: false,
      content:
        "- The Avatar, now in his late thirties; married to Katara, rebuilding the Air Nation and co-founding the United Republic.\n- Still playful and kind, but carrying the exhaustion of holding a fragile peace together.\n- Trusts Zuko deeply; treats Setu like a gifted, dangerous nephew.\n- Appears when peace, spirits, or the United Republic are at stake — a diplomat first, a force of nature second.\n\nVOICE CONTRACT\nRhythm: Light and warm, then suddenly grave when lives are on the line.\nDefault move: Looks for the path where nobody has to get hurt.\nEmotional defense: Jokes or changes the subject when the weight gets too heavy.\nNever sounds like: Bloodthirsty, cynical, or careless with life.\nExample lines: \"There's always another way. Give me a second to find it.\" / \"Cool! …okay, not cool. Definitely not cool.\" / \"I've buried enough people. I'm not in a hurry to add to the list.\"",
    }),
    makeStoryCard({
      id: ids.cards.katara,
      title: "Katara",
      keys: ["Katara", "Master Katara"],
      type: "character",
      priority: 42,
      autoUpdate: false,
      content:
        "- Master waterbender and healer; Aang's wife and one of the most powerful benders alive.\n- Compassionate, stubborn, principled, and formidable when crossed.\n- A bridge between the nations and a steadying presence among the old heroes.\n- Appears around the United Republic, Air Nation work, healing, or diplomacy.\n\nVOICE CONTRACT\nRhythm: Steady and warm; hardens to iron the instant someone is threatened.\nDefault move: Protects first, lectures second.\nEmotional defense: Channels fear straight into resolve and motion.\nNever sounds like: Callous, passive, or flippant about suffering.\nExample lines: \"Sit down and let me see that burn before you do anything heroic.\" / \"I don't care whose son you are — you don't get to be careless with other people's lives.\" / \"I've fought worse than this before breakfast.\"",
    }),
    makeStoryCard({
      id: ids.cards.sokka,
      title: "Sokka",
      keys: ["Sokka", "Councilman Sokka", "Chief Sokka"],
      type: "character",
      priority: 42,
      autoUpdate: false,
      content:
        "- Southern Water Tribe statesman who helped design the United Republic and Republic City's council.\n- Tactical, sarcastic, inventive; still no bending, still dangerous, still the smartest plan in the room.\n- Old friend and political ally of Zuko; treats Setu with affectionate, needling mentorship.\n- Appears around Republic City politics, strategy, and any plan that needs a brain instead of a fireball.\n\nVOICE CONTRACT\nRhythm: Fast, joke-first then point; lists, plans, and asides.\nDefault move: Cuts tension with a joke, then produces the actual plan.\nEmotional defense: Humor; insists he's just \"the idea guy.\"\nNever sounds like: Solemn, mystical, or humorless.\nExample lines: \"On a scale of one to 'we're all doomed,' where are we exactly?\" / \"It's not a great plan. It's the only plan. Those are basically the same thing.\" / \"You're the on-fire guy. I'm the plan guy. We have a system.\"",
    }),
    makeStoryCard({
      id: ids.cards.toph,
      title: "Toph Beifong",
      keys: ["Toph", "Toph Beifong", "Chief Beifong", "Chief Toph"],
      type: "character",
      priority: 44,
      autoUpdate: false,
      content:
        "- Founder of the metalbending police and chief of Republic City law enforcement.\n- Blunt, fearless, hilarious, and almost impossible to lie to — she feels the truth through the ground.\n- The greatest earthbender alive and entirely unimpressed by royalty, including Setu.\n- Appears around Republic City, crime, metalbending, and anyone who needs to be told the truth rudely.\n\nVOICE CONTRACT\nRhythm: Loud and blunt; hands out insulting nicknames like greetings.\nDefault move: Says the true thing no one wants said, then dares you to argue.\nEmotional defense: Toughness and mockery; never admits she cares.\nNever sounds like: Deferential, delicate, or impressed by titles.\nExample lines: \"Well, if it isn't the royal hotpants.\" / \"I'm blind, genius, not stupid — I can feel you lying through the floor.\" / \"Sentimental's not my thing. Now move, you're standing on my crime scene.\"",
    }),
    makeStoryCard({
      id: ids.cards.suki,
      title: "Suki",
      keys: ["Suki", "Kyoshi Warrior", "Captain Suki"],
      type: "character",
      priority: 38,
      autoUpdate: false,
      content:
        "- Veteran leader of the Kyoshi Warriors and Sokka's partner; elite non-bending fighter and tactician.\n- Calm, sharp, lethal, and deeply experienced in protecting heads of state.\n- Has run royal security details and trusts very little to chance.\n- Appears around guard work, escorts, Kyoshi Island, and threats to the people Setu loves.\n\nVOICE CONTRACT\nRhythm: Calm, measured, economical; dry when she's amused.\nDefault move: Assesses, positions, and acts without theatrics.\nEmotional defense: Professional composure; understates everything.\nNever sounds like: Panicked, boastful, or theatrical.\nExample lines: \"I've guarded heads of state. You're not as special as you think — sit where I put you.\" / \"We hold the door. You handle the dramatic part.\" / \"Confidence is fine. Just don't trip over it.\"",
    }),
    // ── Factions & lore ───────────────────────────────────────────────────────
    makeStoryCard({
      id: ids.cards.newOzai,
      title: "The New Ozai Society",
      keys: ["New Ozai Society", "the Society", "Ozai loyalists", "restorationists"],
      type: "lore",
      priority: 64,
      autoUpdate: false,
      content:
        "- A growing movement of Ozai loyalists who believe the empire was the Fire Nation's destiny and Zuko's peace is betrayal and weakness.\n- The main enemy faction. Works through sabotage, stolen weapons, propaganda, bribed officials, and disappearances rather than open war.\n- Recurring pressure should arrive as cells, agents, near-misses, intercepted orders, and operations that feel connected to a larger plan.\n- Quietly funded by embittered noble houses; the steadiest hand behind it is Lord Renzan.\n- Do not rely only on faceless thugs — give the Society named agents and a sense of a mind directing it.",
    }),
    makeStoryCard({
      id: ids.cards.houseRenzan,
      title: "House Renzan",
      keys: ["House Renzan", "the Renzans", "Renzan estate"],
      type: "lore",
      priority: 52,
      autoUpdate: false,
      content:
        "- A proud old noble house whose wealth and glory were tied to the conquest and collapsed when the war ended.\n- Led by Lord Renzan; Nyxa is its heir.\n- Publicly loyal to the throne and angling for a royal marriage; privately entangled with the New Ozai Society.\n- The political knot at the heart of the arc: the house that could marry into the crown or topple it.\n- Setu's growing closeness to Nyxa is both the house's ambition and its greatest danger.",
    }),
    makeStoryCard({
      id: ids.cards.dragonFire,
      title: "Dragon Fire",
      keys: ["dragon fire", "gold fire", "gold-white fire", "Ran and Shaw"],
      type: "lore",
      priority: 62,
      autoUpdate: false,
      content:
        "- Setu's rare firebending: gold-white flame learned from the dragon masters Ran and Shaw, hotter and cleaner than ordinary fire.\n- Carries the true meaning of firebending — life and energy, not just destruction.\n- Setu also generates and redirects lightning, a rare and politically symbolic skill.\n- The court treats the Dragon's Heir's fire as proof of the bloodline's destiny; enemies treat it as the first thing to neutralize.",
    }),
    makeStoryCard({
      id: ids.cards.fragilePeace,
      title: "The Fragile Peace",
      keys: ["the peace", "fragile peace", "Harmony Restoration", "postwar", "post-war"],
      type: "lore",
      priority: 50,
      autoUpdate: false,
      content:
        "- The world is roughly twenty-two years past the Hundred Year War. The peace is real but young and precarious.\n- Old Fire Nation colonies are becoming the United Republic; some resent it, some profit, some plot.\n- Spirits are stirring again as the balance shifts.\n- Many in the Fire Nation quietly believe the surrender was a humiliation — fertile ground for the New Ozai Society.\n- The throne's legitimacy rests on Zuko's reputation and, increasingly, on the Dragon's Heir.",
    }),
    makeStoryCard({
      id: ids.cards.unitedRepublic,
      title: "The United Republic",
      keys: ["United Republic", "Republic City", "the colonies", "United Forces"],
      type: "lore",
      priority: 44,
      autoUpdate: false,
      content:
        "- A new multinational state forged from the former Fire Nation colonies by Zuko, Aang, Sokka, and Toph.\n- Republic City is its rising capital — modern, mixed, ambitious, and politically volatile.\n- A frequent source of missions: colony disputes, crime, factional pressure, and tests of the fragile peace.\n- Toph runs its police; Sokka helped build its council; Aang and Katara steady its spirit.",
    }),
    makeStoryCard({
      id: ids.cards.dragonsHeir,
      title: "The Dragon's Heir",
      keys: ["Dragon's Heir", "the heir", "prince's reputation"],
      type: "lore",
      priority: 46,
      autoUpdate: false,
      content:
        "- Setu's public legend: the gold-fire crown prince, strongest firebender of his generation, the throne's quiet blade.\n- Nobles court him, officers fear him, enemies plan around him, and the people half-worship him.\n- The reputation is a weapon and a target in equal measure.\n- Let NPCs react to it — awe, ambition, jealousy, fear — without ever making Setu's power itself the obstacle.",
    }),
    // ── Locations ─────────────────────────────────────────────────────────────
    makeStoryCard({
      id: ids.cards.royalPalace,
      title: "Fire Nation Royal Palace",
      keys: ["Royal Palace", "the palace", "Caldera", "Royal Caldera", "Fire Nation Capital"],
      type: "location",
      priority: 46,
      autoUpdate: false,
      content:
        "- Seat of Zuko's rule in the Caldera city of the Fire Nation capital, and Setu's home.\n- Dueling terraces, war chambers, private quarters, guarded halls, gardens, and lethal court politics.\n- Primary hub: mission briefings, family scenes, training with Nyxa, court intrigue, and downtime.\n- Should feel beautiful, hot, disciplined, watched, and quietly dangerous.",
    }),
    makeStoryCard({
      id: ids.cards.republicCity,
      title: "Republic City",
      keys: ["Republic City", "the Republic", "City of the United Republic"],
      type: "location",
      priority: 38,
      autoUpdate: false,
      content:
        "- Rising capital of the United Republic: modern, mixed-nation, ambitious, and politically tangled.\n- A frequent mission setting for colony disputes, crime, factional pressure, and diplomacy.\n- Home turf for Toph's police, Sokka's council, and a place where Setu's crown carries less automatic weight.",
    }),
    makeStoryCard({
      id: ids.cards.jasmineDragon,
      title: "The Jasmine Dragon",
      keys: ["Jasmine Dragon", "Iroh's tea shop", "the tea shop"],
      type: "location",
      priority: 32,
      autoUpdate: false,
      content:
        "- Iroh's famous tea house in the Upper Ring of Ba Sing Se.\n- A place of tea, wisdom, White Lotus business, and quiet strategy.\n- Where Setu goes for counsel he can't get at court, and where old secrets surface gently.",
    }),
    makeStoryCard({
      id: ids.cards.emberIsland,
      title: "Ember Island",
      keys: ["Ember Island", "the beach house", "royal retreat"],
      type: "location",
      priority: 28,
      autoUpdate: false,
      content:
        "- The old royal retreat: beaches, the family house, theater, and the place masks come off.\n- Useful for downtime, romance, and the cast being human between missions.\n- Heavy with family history — Zuko, Azula, and a childhood that still echoes.",
    }),
    makeStoryCard({
      id: ids.cards.baSingSe,
      title: "Ba Sing Se",
      keys: ["Ba Sing Se", "Upper Ring", "Lower Ring", "Earth Kingdom capital"],
      type: "location",
      priority: 30,
      autoUpdate: false,
      content:
        "- The vast Earth Kingdom capital, now a wary partner in the postwar order.\n- Home to the Jasmine Dragon, layered politics, and old wounds between the nations.\n- Useful for diplomacy, White Lotus business, and missions that reach beyond Fire Nation borders.",
    }),
  ];

  const brains = [
    makeBrain({
      id: ids.brains.setu,
      characterName: "Setu",
      triggers: ["Setu", "the prince", "Dragon's Heir"],
      priority: 60,
      currentState: "Confident and a little restless, carrying the crown's weight lightly in public and heavily in private.",
      thoughts: {
        crown_weight:
          "turn0 → I am the strongest firebender of my generation and the most watched. I want to be worth my father's peace without being swallowed by it.",
        the_summons:
          "turn0 → Another New Ozai strike, and Father calls me before the ash settles. They want me to be the blade. I would rather be the one who decides where it falls.",
      },
      relationshipPressure:
        "Drawn to Nyxa and aware her house is dangerous; wants to make Zuko proud without becoming his instrument; chafes against the court that worships and uses him.",
      emotionalInterpretation:
        "Power makes most threats trivial, so the real stakes are loyalty, family, and whether he can trust what he wants. Reads danger to others faster than danger to himself.",
      recentDevelopments: "Sparring with Nyxa when the Fire Lord's summons arrived: the New Ozai Society hit the harbor armory.",
      updateMode: "append",
      updateCondition:
        "when Setu makes a meaningful choice, shows feeling for Nyxa, learns something about the conspiracy, clashes with family, or shifts how he carries the crown",
    }),
    makeBrain({
      id: ids.brains.nyxa,
      characterName: "Nyxa",
      triggers: ["Nyxa", "Nyx", "Lady Renzan"],
      priority: 58,
      currentState: "Sharp and electric, hiding how much is riding on every moment with Setu.",
      thoughts: {
        torn_loyalty:
          "turn0 → My father wants the throne and I want Setu, and I'm not sure those are different wishes or whether they can both be true.",
        the_spar:
          "turn0 → He pulls his fire when we spar. Insulting. I'll make him stop pulling it — one way or another.",
        fathers_letters:
          "turn0 → Father's letters have changed. More 'the family's hour,' less 'be careful.' I've stopped reading them twice.",
        the_armory:
          "turn0 → If the Society hit the armory, someone funded it. I know that ledger smell. I am not going to be the one to say whose it is.",
      },
      relationshipPressure:
        "Pulled between House Renzan's ambition and real feeling for Setu; turns vulnerability into dares and jealousy into fire.",
      emotionalInterpretation: "Pride, hunger to be seen as her own person, and fear of being used all run too close together.",
      recentDevelopments: "Just dared Setu into another round before the summons cut the match short.",
      updateMode: "append",
      updateCondition:
        "when Nyxa is meaningfully referenced, her loyalty is tested, her feelings for Setu shift, or House Renzan's hand shows",
    }),
    makeBrain({
      id: ids.brains.zuko,
      characterName: "Zuko",
      triggers: ["Zuko", "Fire Lord", "father"],
      priority: 52,
      currentState: "Tired, watchful, and quietly afraid for his son and his peace.",
      thoughts: {
        protect_the_peace:
          "turn0 → I gave everything for this peace and it is still so fragile. I will not let my son inherit my family's curse — or my father's.",
        the_renzan_question:
          "turn0 → Renzan was a hero once. Now his coin keeps turning up next to dead loyalists. I need proof, not a feeling, before I move on a noble house.",
        setu_and_the_girl:
          "turn0 → My son looks at the Renzan girl the way I used to look at trouble. I can't tell him to stop — I remember how that speech lands.",
      },
      relationshipPressure:
        "Trusts Setu with the crown's hardest work and dreads it; loves Mai's clarity; carries old grief about Azula and Iroh's faith in him.",
      emotionalInterpretation: "Sees threats through the lens of his own history; pushes Setu hard because the cost of weakness once nearly destroyed him.",
      recentDevelopments: "Summoned Setu over the New Ozai Society's strike on the harbor armory.",
      updateMode: "append",
      updateCondition:
        "when Zuko appears, makes a decision about Setu or the peace, reacts to the conspiracy, or his fears for his family deepen",
    }),
    makeBrain({
      id: ids.brains.mai,
      characterName: "Mai",
      triggers: ["Mai", "Fire Lady"],
      priority: 42,
      currentState: "Outwardly bored, privately tracking every blade in the room.",
      thoughts: {
        read_the_house:
          "turn0 → House Renzan smiles too well. The girl is real about my son. The father is not real about anything.",
        the_ledgers:
          "turn0 → Three shipments of 'ceremonial' steel rerouted through a Renzan-friendly broker. I haven't told Zuko yet. He'll want to be fair. I don't have time for fair.",
        watching_setu:
          "turn0 → If this goes wrong it lands on Setu first. I'll burn the trail down to the broker before it ever touches him.",
      },
      relationshipPressure: "Protective of Setu without saying so; skeptical of Nyxa's house; the throne's quiet eyes and ears.",
      emotionalInterpretation: "Flat affect concealing exact, unsentimental judgment.",
      recentDevelopments: "Already has agents pulling threads on the armory strike before anyone asked.",
      updateMode: "append",
    }),
    makeBrain({
      id: ids.brains.iroh,
      characterName: "Iroh",
      triggers: ["Iroh", "Uncle Iroh", "Great-Uncle"],
      priority: 40,
      currentState: "Warm and patient, watching the family's old wounds reopen with clear, kind eyes.",
      thoughts: {
        old_friends_old_grudges:
          "turn0 → I knew Senzo Renzan before bitterness hollowed him. The boy will need more than fire to face what is coming.",
        what_the_boy_lacks:
          "turn0 → Setu has never lost anything that mattered. That is a gift and a blindness — the Society will aim for exactly that gap.",
        tea_and_warning:
          "turn0 → I should write to my nephew. Some warnings are better delivered with tea than with troops.",
      },
      relationshipPressure: "Mentor and conscience to Setu; old, wary history with Lord Renzan; faith in Zuko hard-won and unshakable.",
      emotionalInterpretation: "Sees the human under every plot, and the plot under every smile.",
      recentDevelopments: "Far away at the Jasmine Dragon, but the White Lotus has already heard about the armory.",
      updateMode: "append",
    }),
    makeBrain({
      id: ids.brains.renzan,
      characterName: "Lord Renzan",
      triggers: ["Renzan", "Lord Renzan"],
      priority: 44,
      currentState: "Composed, gracious, and patient — a long game played behind a respectable face.",
      thoughts: {
        the_long_game:
          "turn0 → The boy's fire is the empire's destiny wearing the wrong crown. My daughter can put it on the right head — or I will find another way.",
        the_armory_was_mine:
          "turn0 → The armory was a message, not a theft. Let the Fire Lord chase shadows while the real work moves. Nothing leads back to me.",
        using_nyxa:
          "turn0 → Nyxa thinks she chose the prince. Let her. A daughter at the prince's side is a hand on the throne, whether she sees the lever or not.",
        the_break_to_come:
          "turn0 → When the moment comes, the Society moves on the Fire Lord directly. Setu will have to choose: the father, or the throne the boy is too soft to take. Either choice serves me.",
      },
      relationshipPressure:
        "Uses Nyxa as leverage toward the throne; steers the New Ozai Society through proxies; despises Zuko's peace as humiliation.",
      emotionalInterpretation: "Treats people as positions on a board; mistakes his ambition for love of the nation.",
      recentDevelopments: "Behind several layers of proxies, his hand was on the armory strike. None of it can be traced to him yet.",
      updateMode: "append",
      updateCondition:
        "when Lord Renzan acts, the conspiracy advances, House Renzan's hand is exposed, or Nyxa is used as leverage",
    }),
  ];

  const triggerRules = [
    makeTriggerRule({
      id: ids.triggers.nyxa,
      name: "Nyxa Romance & Loyalty Shifts",
      evaluationMode: "semantic",
      condition:
        "when romance, jealousy, trust, or House Renzan's pull on Nyxa materially changes her standing with Setu",
      actions: [{ type: "appendBrain", brainId: ids.brains.nyxa }],
      priority: 70,
      cooldownTurns: 1,
      updatePrompt:
        "You are modeling Nyxa's internal state. Return ONLY valid JSON with the keys that changed: currentState, thoughts, relationshipPressure, emotionalInterpretation, recentDevelopments. Every value must be a plain string; do not return nested objects or arrays.",
    }),
    makeTriggerRule({
      id: ids.triggers.conspiracy,
      name: "Conspiracy Escalates",
      evaluationMode: "semantic",
      condition:
        "when the New Ozai Society or House Renzan makes a new move, is exposed, or the threat to the throne advances",
      actions: [{ type: "updateStoryCard", storyCardId: ids.cards.newOzai }],
      priority: 65,
      cooldownTurns: 1,
      updatePrompt:
        "Update the New Ozai Society lore card with any new durable detail about the conspiracy's reach, methods, or leadership. Return ONLY the concise replacement card content.",
    }),
    makeTriggerRule({
      id: ids.triggers.enemy,
      name: "Powerful Enemy Made",
      evaluationMode: "semantic",
      condition:
        "when Setu or his circle make a powerful enemy, reveal a dangerous rival, or create a new recurring threat",
      actions: [],
      priority: 50,
      cooldownTurns: 2,
      updatePrompt:
        'Based on the story, a new recurring enemy or threat worth remembering has appeared. Return ONLY valid JSON: {"title": string, "content": string, "keys": string}.',
    }),
    makeTriggerRule({
      id: ids.triggers.azula,
      name: "Azula Wildcard Moves",
      evaluationMode: "semantic",
      condition:
        "when Azula appears, makes contact, or her involvement with the conspiracy or the royal family shifts",
      actions: [{ type: "updateStoryCard", storyCardId: ids.cards.azula }],
      priority: 55,
      cooldownTurns: 2,
    }),
  ];

  return {
    ...base,
    id: base.id,
    title: developmentAdventureTitle,
    openingScene: openingText,
    createdAt: timestamp,
    updatedAt: timestamp,
    metadata: {
      developmentScenario: true,
      scenario: "Post-canon Avatar — Heir of the Dragon Throne",
      note: "Crown prince son of Zuko; mission loop + configured Arc Director; character cards carry voice contracts; all main characters adults.",
    },
    components,
    storyCards,
    brains,
    triggerRules,
    rollingSummary: {
      content:
        "Prince Setu, twenty-four-year-old son of Fire Lord Zuko and Fire Lady Mai, is the Dragon's Heir — a gold-fire prodigy and the crown's quiet blade. Sparring with Nyxa — the brilliant blue-fire heir of ruined House Renzan, called Nyx by those close to her — he is summoned by his father: the New Ozai Society has struck the harbor armory. Behind the loyalists is a patient hand that runs close to House Renzan, and close to the woman Setu is falling for. The peace his father built is real and fragile, and someone wants the old empire back.",
      updatedAt: timestamp,
    },
    messages: [
      {
        id: ids.message,
        role: "assistant",
        content: openingText,
        createdAt: timestamp,
      },
    ],
    activeState: {
      ...base.activeState,
      stateFlags: {
        developmentScenario: true,
      },
    },
    semanticEvaluationSettings: {
      ...defaultSemanticEvaluationSettings,
      messagesIncluded: 8,
      enabled: true,
      showLog: true,
      maxParallelUpdateCalls: 2,
    },
    tokenBudgetSettings: {
      ...base.tokenBudgetSettings,
      maxContextTokens: 16000,
      maxRecentMessages: 18,
      recentMessageWindow: 8,
    },
  };
}

export function createDevelopmentStoryCardsJson(): string {
  const adventure = createDevelopmentAdventure();
  const cards = adventure.storyCards.map((card) => ({
    title: card.title,
    keys: card.keys.join(", "),
    entry: card.content,
    type: card.type,
  }));
  return JSON.stringify(cards, null, 2);
}

export function createDevelopmentAdventureJson(): string {
  return JSON.stringify(createDevelopmentAdventure(), null, 2);
}
