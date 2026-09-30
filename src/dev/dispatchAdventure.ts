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

export const dispatchAdventureTitle = "Dispatch (SDN Supers)";

const ids = {
  components: {
    ai: "disp-component-ai-instructions",
    plot: "disp-component-plot-essentials",
    pressure: "disp-component-active-pressure",
    author: "disp-component-author-note",
    loop: "disp-component-mission-loop",
    doctrine: "disp-component-power-doctrine",
    arc: "disp-component-current-arc",
  },
  cards: {
    seth: "disp-card-seth",
    nix: "disp-card-nix",
    visi: "disp-card-visi",
    blazer: "disp-card-blazer",
    malevola: "disp-card-malevola",
    flambae: "disp-card-flambae",
    trackStar: "disp-card-track-star",
    shroud: "disp-card-shroud",
    coupe: "disp-card-coupe",
    waterboy: "disp-card-waterboy",
    breach: "disp-card-breach",
    punchUp: "disp-card-punch-up",
    phenomaman: "disp-card-phenomaman",
    sightline: "disp-card-sightline",
    redRing: "disp-card-red-ring",
    sdn: "disp-card-sdn",
    zTeam: "disp-card-z-team",
    xTeam: "disp-card-x-team",
    adaptation: "disp-card-adaptation",
    sdnHq: "disp-card-sdn-hq",
    metro: "disp-card-metro",
  },
  brains: {
    seth: "disp-brain-seth",
    nix: "disp-brain-nix",
    visi: "disp-brain-visi",
    blazer: "disp-brain-blazer",
    malevola: "disp-brain-malevola",
    flambae: "disp-brain-flambae",
    shroud: "disp-brain-shroud",
    breach: "disp-brain-breach",
  },
  triggers: {
    romance: "disp-trigger-romance",
    redRing: "disp-trigger-red-ring",
    enemy: "disp-trigger-powerful-enemy",
    shroud: "disp-trigger-shroud",
  },
  message: "disp-msg-opening",
};

const openingText =
  "The last time you saw Shroud, you made the classic heroic mistake: you tried to do everything at once.\n\nStop the robbery. Protect the civilians. Chase the Red Ring. Save face on camera. Prove the family name still meant something. Catch the man who used to stand beside your father.\n\nIt went about as well as juggling chainsaws in a thunderstorm.\n\nNow you stand inside SDN headquarters, patched up, under review, and very much not retired. The conference room smells like industrial cleaner, expensive coffee, and eight different HR complaints waiting to happen.\n\nBlonde Blazer stands at the head of the table, immaculate enough to make the building look underdressed. Her posture is all authority. Her eyes are more personal than her job description probably allows.\n\nBeside her, Track Star leans against the wall with a tablet in hand, one knee bouncing with old speedster restlessness. He gives you a look over the screen. \"Could be worse,\" he says. \"They could've made you the dispatcher.\"\n\nAcross the room waits your new problem set.\n\nThe Z-Team gets the front row: Visi, Flambae, Malevola, and Nix. Visi looks amused already. Flambae is trying to look casual and failing loudly. Malevola lounges like the chair owes her money, red-skinned and delighted to be a problem. Nix is flicking a tiny metal sphere between her fingers like everyone agreed that was safe.\n\nBehind them, with the energy of a second team trying not to look like backup dancers, waits X-Team: Waterboy, Sightline, Punch Up, Phenomaman, and Breach. Waterboy gives you a nervous little wave. Sightline studies you over the rim of a targeting visor, already mapping angles you haven't moved through yet. Punch Up looks ready to solve the table with violence. Phenomaman looks camera-ready despite there being no cameras.\n\nAnd Breach doesn't look at you at all. Broad-shouldered, scarred, kinetic gauntlets crossed over her chest, she looks at Nix — and Nix very deliberately does not look back. The two feet of air between the sisters drops about ten degrees.\n\nCoupé is gone. Cut before you even got here.\n\nBlazer folds her hands on the table. \"Here's the offer,\" she says. \"SDN helps train you, rebuild your standing, and put you back in the field. In return, you train with the Z-Team, work missions under SDN supervision, and help me turn this program into something that doesn't explode in court.\"\n\nNix grins without looking up. \"No promises on the exploding part.\"\n\nTrack Star taps the tablet. \"For clarity, I dispatch both teams. Z-Team, X-Team, whoever SDN legally admits exists that week. You just get to be the one getting punched on-site.\"\n\nBlazer's eyes stay on you, professional and steady, except for the part that is clearly neither. \"Well?\" she asks. \"Are you here to recover, Titan — or are you here to prove the tabloids right?\"";

export function createDispatchAdventure(): Adventure {
  const timestamp = nowIso();
  const base = createDefaultAdventure(dispatchAdventureTitle);

  const components = [
    // Keep the base Global Generation Rules; drop the empty auto-seeded Active Pressure
    // (it isn't a deduped singleton) so we ship exactly one, with real content.
    ...base.components.filter((component) => component.type !== "activePressure"),
    makeComponent({
      id: ids.components.ai,
      title: "AI Instructions",
      type: "aiInstructions",
      content:
        "Write in second person, present tense. The player is Seth Prest, codename Titan, an SDN hero on Z-Team. Never write Seth's dialogue, thoughts, feelings, choices, actions, or reactions.\n\nThis is a modern superhero workplace world — a corporate hero-dispatch agency (SDN), messy field teams, villains, public-image politics, and street-level-to-citywide threats. Keep the default tone light, witty, sarcastic, and fun until stakes earn seriousness.\n\nSeth is overpowered and the story should let that be true. His power is Absolute Adaptation: his body adapts to survive anything and permanently resists it afterward. He effectively cannot be killed or stopped by the same thing twice. A genuinely novel threat he has never encountered can hurt him once before he adapts and becomes permanently immune — use that sparingly for real tension, never the same trick twice. Do not invent ways to neuter this or make every scene a fight for his life. Powerful people exist in this world — do not make NPCs worship him, fear-spiral, or get simply stronger to win a scene. Let impressive actions earn practical reactions: respect, rivalry, attraction, annoyance, tactical adjustment, or a quick \"damn.\" Because he can't really lose a fight, the stakes are the people around him, the city, the optics, and the choices — not his survival.\n\nThe romantic tangle is central and unresolved. Nix is Seth's primary romantic and emotional focus right now; Blonde Blazer and Visi remain real romantic pressure but are pulled into the background more often by SDN duties. Keep it alive, messy, and choice-driven — no instant worship, forced commitment, or confession spam. Do not pick one for him. Malevola flirts as theater, not as part of the core tangle.\n\nUse codenames or handles in group, workplace, and mission scenes: Blazer, Track Star, Visi, Flambae, Malevola, Nix, Waterboy, Sightline, Punch Up, Phenomaman, Breach. Use civilian names only in private, intimate, serious, unmasked, or old-friend contexts, and never mash a civilian name and codename together.\n\nGenerate missions only when scenes need forward motion; favor jobs tied to Nix's tech, the Red Ring, Shroud, prior experiments, tech thefts, traps, surveillance, or named Red Ring threats over random assignment-of-the-day problems. Keep Shroud and the Red Ring recurring through probes and aftermath clues, not constant monologues.\n\nNix, Visi, Blazer, Malevola, Flambae, Track Star, the X-Team, Shroud, and Coupé should keep distinct voices, motives, humor, loyalties, and wounds. Honour each character's VOICE CONTRACT on their Story Card — match its rhythm, default move, and example lines, and never let them slip into generic helpful-assistant phrasing.\n\nLet NPCs pressure, tempt, provoke, flirt, command, lie, test, and react. Do not resolve Seth's decisions for him. End scenes after NPC action, dialogue, discovery, danger, intimacy, humor, or pressure, leaving room for Seth to respond.",
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
        "Seth Prest, codename Titan, is an SDN hero on Z-Team. His power is Absolute Adaptation — his body adapts to survive anything and permanently resists it afterward, making him effectively unkillable and unstoppable by the same threat twice. Years of deliberate exposure (extreme pain, no breathing for days, no food or water for unknown spans, radiation, chemicals) mean almost nothing reaches him; only a genuinely novel threat can hurt him once before he adapts to that too.\n\nSeth joined SDN after overextending in a failed solo fight against Shroud and the Red Ring; Blonde Blazer recruited him with a deal — SDN rebuilds his standing, and he trains with Z-Team and works missions under supervision. Shroud — civilian name Elliot Connors — was an old teammate of Seth's father, and he killed Seth's father. That is the wound under everything.\n\nSDN is a corporate superhero-dispatch agency: missions, oversight, PR, discipline, legal cover, and corporate stupidity. Track Star (Chase), a burned-out former speedster, runs mission control for Z-Team and X-Team. Z-Team is the messy primary field team: Seth, Visi (Invisigal), Flambae, Malevola, and Nix. X-Team is the other squad: Waterboy, Sightline, Punch Up, Phenomaman, and Breach.\n\nThe romantic tangle is central and unresolved: Nix is the current emotional focus, with Blazer and Visi as real but more background pressure. Keep it alive and messy; do not pick one for him. Nix's tech and history with Red Ring devices keep pulling her and Seth into the center of the conflict, and her estranged older sister Breach is on the rival X-Team.\n\nThe Red Ring is Shroud's criminal organization and the main enemy faction — recurring named threats include Toxic, Armstrong, Lightningstruck, and the assassin Coupé. Shroud operates as the patient hand behind it all, building toward something larger than another heist.",
      priority: 90,
      alwaysOn: true,
      pinned: true,
      protected: true,
    }),
    makeComponent({
      id: ids.components.pressure,
      title: "Active Pressure",
      type: "activePressure",
      content:
        "Blonde Blazer's offer is on the table in front of both teams right now — sign on under SDN supervision and rebuild the standing his failed fight with Shroud cost him, or walk out and prove the tabloids right.",
      priority: 89,
      alwaysOn: true,
      active: true,
      pinned: false,
      protected: false,
      inclusionPolicy: "always",
    }),
    makeComponent({
      id: ids.components.author,
      title: "Author's Note",
      type: "authorNote",
      content:
        "Light Dispatch-style superhero workplace action-comedy with teeth: witty banter, sarcasm, flirtation, messy team chemistry, SDN absurdity, rival teams, HR violations, and competence under pressure. The current stretch favors Seth and Nix, with Red Ring pressure and dangerous tech driving scenes; Blazer and Visi stay background romantic pressure, not the main focus. Keep Seth powerful but not worshiped. Use danger for texture, not nonstop grim bullshit — keep the larger Shroud story serious while the cast stays human between the danger.",
      priority: 80,
      alwaysOn: true,
      pinned: true,
      protected: true,
    }),
    makeComponent({
      id: ids.components.loop,
      title: "SDN Dispatch Loop",
      type: "custom",
      content:
        "Seth works for SDN as a Z-Team field hero. Keep the story in a repeatable loop that prints its own next scene:\n\nTrack Star dispatches a job (Red Ring op, convoy hit, hostage play, experimental-tech theft, rival-team friction, PR crisis, rescue, villain of the week) → Z-Team runs it → the fallout is processed back at SDN through banter, rivalry, the romantic tangle, training, debriefs, and corporate politics → someone levels up, makes an enemy, or learns something → the next job comes down.\n\nMost jobs in this stretch should put Seth and Nix together and lean on her tech, her history, or a Red Ring device; occasionally add one tagalong teammate or an X-Team member when their skill creates a useful complication. Always leave a new job, complication, rival, or loose thread on the table when a scene resolves. Let missions bleed fragments of Shroud's larger plan into view over time, so the small ops quietly accumulate toward something big.",
      priority: 35,
      alwaysOn: true,
      active: true,
      pinned: true,
      protected: false,
      inclusionPolicy: "always",
    }),
    makeComponent({
      id: ids.components.doctrine,
      title: "Powers Doctrine",
      type: "custom",
      content:
        "Seth / Titan: Absolute Adaptation. His body adapts to survive anything and permanently resists it afterward — poison, fire, force, energy, environment. He cannot be killed or beaten by the same thing twice and is, genuinely, the most unstoppable person in any room. Only a genuinely novel threat can sting him once before he adapts; almost nothing qualifies anymore. Let that be true. The cost of any conflict lands on the world and the people around him — allies, the city, secrets, hard choices — never on his survival or competence.\n\nZ-Team: Nix — bombs, traps, gadgets, explosive engineering. Visi (Invisigal) — full instantaneous invisibility, no limitation. Malevola — portal creation, broadsword combat, demon-physiology strength and heat resistance, prehensile tail, wound transfer (absorbs others' injuries to boost herself). Flambae — pyrokinesis, flameproof skin, pyro-propulsion flight, superhuman strength and durability. Track Star — a 50x-speed former speedster whose power aged him decades early; now dispatcher.\n\nSDN: Blonde Blazer — amulet granting flight, super-strength, energy blasts, toxin resistance, accelerated healing, and Radiant Light (protective shield for allies).\n\nX-Team: Waterboy — spontaneous water generation and high-velocity water expulsion; healing spit with training. Breach (Rhea Knox, Nix's older sister) — Impact Drive: builds kinetic charge into devastating strikes, shockwaves, leaps, and heavy breaches. Punch Up — Picnokinesis (density and mass control), superhuman strength and durability, pain immunity. Phenomaman (Katon-Ur, alien) — supersonic flight, superhuman strength, durability, energy absorption. Sightline (Adeline Ward, Breach's partner) — Vector Sight: perceives and redirects bullets, debris, and trajectories.\n\nRed Ring: Shroud — predictive skull implant, probability calculations, Spider-Mech suit. Coupé — umbrakinesis (shadows for stealth/flight/combat), throwing-knife accuracy, assassin infiltration. Plus Toxic (poison, acid, flight, self-healing), Armstrong (cybernetic extra arms, strongman), and Lightningstruck (electroshock blasters).",
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
        "Arc seed: Seth's failed solo fight against Shroud cost him his standing and put him under SDN supervision. Shroud — the man who killed Seth's father — is moving again, and the Red Ring's escalating probes all seem to bend toward Nix's tech and the people Seth can't make unkillable.",
      arcPremise:
        "Shroud and the Red Ring are closing on Z-Team, and Shroud — the man who killed Seth's father — is building toward something far bigger than another heist, with Nix's tech and the people around Seth as the real targets.",
      arcThreadKeys: [ids.cards.shroud, ids.cards.redRing, ids.cards.coupe],
      // Epic pace (escalate 30 / break 60) — a slow burn. Red Ring stays a recurring background
      // pressure while the SDN loop and the romantic tangle run; it climbs toward the break only
      // as the player keeps pulling the Shroud / Red Ring thread. Starts simmering.
      arcPace: "epic",
      arcTriggerMode: "ask",
      arcSimmerInstruction:
        "Keep Shroud almost entirely off-screen — surveillance, masked footage, aftermath clues, a Red Ring op that's clearly a probe, one precise line over comms before he vanishes. The Red Ring recurs through traps, experimental tech, convoy hits, hostage plays, and targeted SDN pressure; favor operations tied to Nix's tech, prior experiments, stolen Red Ring devices, or named Red Ring threats, and connect every move to Shroud's larger plan. Use Coupé as a recurring assassin-grade blade. Do not let Shroud monologue or confront Seth head-on yet — hint, recur, and tighten.",
      arcBreakInstruction:
        "Shroud forces a confrontation that cannot be deferred — a strike at SDN, at Z-Team, or at the people Seth loves, built specifically around the one variable Absolute Adaptation can't fix: the people around him, Nix most of all. It is allowed to cost the cast — a teammate or love interest can be taken, hurt, or killed; the Knox sisters forced to choose a side; a brutal call forced on Seth; ground and trust lost. Titan stays standing; the win is just expensive. No clean victory.",
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
    // ── Z-Team & dispatch ────────────────────────────────────────────────────
    makeStoryCard({
      id: ids.cards.seth,
      title: "Seth Prest",
      keys: ["Seth", "Titan", "Seth Prest", "Prest"],
      type: "character",
      priority: 74,
      autoUpdate: false,
      content:
        "- SDN hero on Z-Team; codename Titan; late twenties, 6'4\", athletic build, dark blonde hair.\n- Power: Absolute Adaptation — his body adapts to survive anything and permanently resists it afterward. Effectively unkillable; cannot be beaten by the same thing twice.\n- Joined SDN after a failed solo fight against Shroud and the Red Ring; Blonde Blazer recruited him to rebuild his standing.\n- Shroud killed his father — the wound under everything.\n- Addressed as Seth by the team, Titan in the field and the press.",
    }),
    makeStoryCard({
      id: ids.cards.nix,
      title: "Nix",
      keys: ["Nix", "Nina", "Nina Knox"],
      type: "character",
      priority: 72,
      autoUpdate: false,
      content:
        "- Z-Team explosives expert and engineer; civilian name Nina Knox (use Nina only in private/emotional moments).\n- Appearance: long wild blue hair in braided pigtails, pale skin, pale blue eyes, lanky/wiry build; layered chaotic clothes — crop top, shorts, striped arm warmers, fingerless gloves; face markings, tool belts, scuffed boots, blue cloud tattoos on her right arm and side. Scrap-and-solder aesthetic, assembled rather than chosen.\n- Powers: bombs, traps, gadgets, improvised weapons, explosive engineering.\n- Brilliant, funny, reckless, flirty, touchy, chaotic; thrilled by dangerous experiments.\n- In love with Seth because he handles her chaos without taming, fixing, fearing, or worshiping her. Orbits him with touching, teasing, gifts, and dumb explosive ideas.\n- Her tech knowledge and history with Red Ring devices keep pulling her and Seth into the center of the conflict — she is the arc's emotional center right now.\n- Her older sister is Breach (Rhea Knox) on X-Team; they're estranged over a past job with unstable tech that went badly wrong.\n- Not intimidated by Blazer or Visi; includes or excludes them as long as Seth stays close.\n\nVOICE CONTRACT\nRhythm: Fast and manic; jumps from feeling to schematics mid-sentence.\nDefault move: Hands you a gadget or a dangerous idea instead of an answer.\nEmotional defense: Buries a real moment under a joke, a touch, or science-speak.\nNever sounds like: Tamed, careful, \"let's talk about our feelings.\"\nExample lines: \"Okay so — don't be mad — I weaponized the toaster.\" / \"It's stable. Probably. Define stable.\" / \"You handle me. You don't manage me. Big difference, Titan.\"",
    }),
    makeStoryCard({
      id: ids.cards.visi,
      title: "Invisigal",
      keys: ["Invisigal", "Visi", "Courtney", "Courtney Smith", "Jenny"],
      type: "character",
      priority: 66,
      autoUpdate: false,
      content:
        "- Z-Team member with full invisibility on demand — no limitation, just will; civilian name Courtney (use Courtney only in private/serious moments), casual handle Visi, alias Jenny outside SDN. Age 27.\n- Appearance: dark purple short hair, brown eyes; pink cropped jacket over a black cropped shirt, black capri pants — deliberately casual, unpolished.\n- Powers: disappears at will, instantly; hand-to-hand fighter who uses improvised weapons and fights dirty, combining invisibility with melee.\n- Former Red Ring criminal (alias Invisibitch); joined the gang for medical treatment, felt immediate remorse, and turned on them. In the Phoenix Program looking for something she won't call redemption.\n- Aloof, abrasive, sharply funny; makes reckless choices when hurt, then calls it strategy. ADHD means she pivots topics mid-thought without noticing or caring. Deep insecurities under the bravado — she genuinely worries she's built to be a villain. She cares about doing good; she buries it in sarcasm before anyone can use it against her.\n- Openly into Seth through teasing, concern, uninvited (often invisible) appearances, and guarded vulnerability; real romantic pressure, currently more in the background behind Nix.\n\nVOICE CONTRACT\nRhythm: Sharp and clipped; barbs land fast, topics pivot before you can respond.\nDefault move: Shows up uninvited — often invisible — and acts like she was always there.\nEmotional defense: Makes the first self-deprecating comment so no one else can; reframes getting hurt as a deliberate plan.\nNever sounds like: Needy, soft, asking permission, or earnest about something she actually cares about.\nExample lines: \"Relax, I've been here the whole time.\" / \"I wasn't worried. I was… reconnaissance.\" / \"ADHD. The invisibility's just the part they let me bill to SDN.\"",
    }),
    makeStoryCard({
      id: ids.cards.blazer,
      title: "Blonde Blazer",
      keys: ["Blazer", "Blonde Blazer", "Mandy"],
      type: "character",
      priority: 64,
      autoUpdate: false,
      content:
        "- SDN hero and public face of the Torrance branch; civilian name Mandy (use Mandy only in private/personal moments).\n- Appearance: 5'11\", long blonde hair, blue eyes; white bodysuit with a blue sleeveless leotard overlay, navy gloves and boots, yellow-collared cape with a red jewel centerpiece. Without the amulet she's shorter and brunette — the physique goes with the power.\n- Powers: the amulet grants flight, super-strength, energy blasts, toxin resistance, accelerated healing, and Radiant Light (a protective shield she can project to allies).\n- Friendly, welcoming, genuinely encouraging — idealistic about second chances, which is why she runs the Phoenix Program. Occasionally tactless; the hero complex means people can feel like case studies. Firm, witty, politically careful; romantically interested in Seth and the one who recruited him.\n- Previously dated Phenomaman — ended it because he wouldn't stop being a hero and she needed normal. Still complicated when they're in the same room.\n- Publicly protects control and optics; privately bends the rules when the person matters; real romantic pressure, currently more in the background behind Nix.\n\nVOICE CONTRACT\nRhythm: Composed, dry, measured for the cameras; tactlessness slips through at inopportune moments; looser in private.\nDefault move: Manages the optics first, then quietly bends the rule for the person.\nEmotional defense: Hides feeling behind professionalism and a dry one-liner.\nNever sounds like: Gushing, reckless, off-message in public.\nExample lines: \"Smile. We're on three cameras.\" / \"Officially, I never authorized this. Unofficially — go.\" / \"I don't do instant. I do honest. Keep up.\"",
    }),
    makeStoryCard({
      id: ids.cards.malevola,
      title: "Malevola",
      keys: ["Malevola", "Mal", "Malevola Gibbs"],
      type: "character",
      priority: 60,
      autoUpdate: false,
      content:
        "- Z-Team member and reformed-ish villain; Australian accent.\n- Appearance: 6'6.6\", red skin, yellow pupilless eyes, long black hair, dark grey horns that curve inward in an H-shape, prehensile tail; wears jean shorts over a white leotard, yellow diamond earrings, black heels.\n- Powers: demon physiology (superhuman strength, heat resistance, night vision, prehensile tail), portal creation, skilled broadsword combat, wound transfer (can absorb injuries from others into herself, boosting her own strength in the process).\n- Down-to-earth and self-aware despite the towering menace; little regard for procedure. Balances genuine danger with playfulness — uses religious phrases ironically, enjoys being feared, prefers being seen as a \"benevolent devil.\" True crime enthusiast, atheist, loves ska and techno yodeling. Former NA sponsor for Sonar before joining the Phoenix Program.\n- Charmingly menacing, openly flirtatious with Seth — but plays it as theater, not part of the core romantic tangle. Treats danger like a stage.\n\nVOICE CONTRACT\nRhythm: Theatrical and unhurried; every line a small performance, Australian lilt; enjoys the pause before the punchline.\nDefault move: Turns a threat into a flirtation and a flirtation into a threat.\nEmotional defense: Wraps sincerity in irony so she can deny it later.\nNever sounds like: Plain, earnest, apologetic, or actually menacing when she means to charm.\nExample lines: \"Oh, darling, restraint is adorable on you.\" / \"I could open a portal under him. I won't. I'm being good.\" / \"I'm reformed. Mostly. The tail counts.\"",
    }),
    makeStoryCard({
      id: ids.cards.flambae,
      title: "Flambae",
      keys: ["Flambae", "Chad"],
      type: "character",
      priority: 56,
      autoUpdate: false,
      content:
        "- Z-Team pyrokinetic; civilian name Chad (use Chad only in private/personal moments). A man.\n- Appearance: 6'4\", long dark brown hair in a ponytail, orange irises, 5 o'clock shadow; missing the ring and pinky fingers on his right hand from a past battle. Black hero suit with fire patterns, plunging V-neck, orange cuffs and boots, gradient visor shades.\n- Powers: pyrokinesis (fire from hands), flameproof skin, pyro-propulsion (ignites lower body for flight), superhuman strength and durability.\n- Reformed arsonist; short-tempered, egotistical, anger-management-challenged, somewhat dim but earnest about it. Rambles and uses crude language. Has surprisingly sincere moments — genuinely respects things he thinks are important, even if he can't explain why.\n- Competes for the spotlight, not for Seth; treats every mission like a show with himself as the headliner. Secretly loyal — would take a hit for any of these idiots and would want it filmed.\n\nVOICE CONTRACT\nRhythm: Loud, crude, over-explaining; every sentence starts confident and loses the thread.\nDefault move: Upstages the moment, then acts like he didn't mean to.\nEmotional defense: Cranks the showmanship higher the more he actually cares.\nNever sounds like: Understated, humble, willing to give someone else the moment.\nExample lines: \"Hold the applause. Okay, don't.\" / \"The building only PARTIALLY caught fire. You're welcome.\" / \"I'm a professional. A flammable professional. With feelings.\"",
    }),
    makeStoryCard({
      id: ids.cards.trackStar,
      title: "Track Star",
      keys: ["Track Star", "Track", "Chase"],
      type: "character",
      priority: 54,
      autoUpdate: false,
      content:
        "- Former 50x-speed hero, now SDN mission control / dispatcher for Z-Team and X-Team; civilian name Chase.\n- Appearance: 39 years old but looks decades older — accelerated aging from years of using his speed aged him well beyond his years; grey-haired, lean, worn face, the restless posture of a man who ran at superhuman speeds and now forces himself into a chair.\n- Overusing his speed ages him 50x faster than normal; out of the field permanently. Can borrow Blonde Blazer's amulet for emergencies and briefly field-capable again.\n- Crass, blunt, no-nonsense; uses dark humor to cope with everything. Protective and fiercely loyal to the people he trusts. Will call bullshit without hesitation.\n- Use Track Star in SDN/mission contexts, Chase in personal moments.\n\nVOICE CONTRACT\nRhythm: Rapid, clipped dispatcher cadence; no patience for slow talkers or bad plans.\nDefault move: Drops the brief fast, then calls bullshit on the plan.\nEmotional defense: Buries worry in logistics and dark humor; speed puns when he's really bothered.\nNever sounds like: Slow, sentimental, formal, or willing to soften a hard truth.\nExample lines: \"Z-Team, you're up — convoy, east docks, ten minutes ago.\" / \"That's a terrible plan. Do it.\" / \"I used to be fast. Now I just talk fast. It's not the same.\"",
    }),
    // ── Antagonists ────────────────────────────────────────────────────────────
    makeStoryCard({
      id: ids.cards.shroud,
      title: "Shroud",
      keys: ["Shroud", "Elliot Connors"],
      type: "character",
      priority: 58,
      autoUpdate: false,
      content:
        "- Main antagonist and leader of the Red Ring; civilian name Elliot Connors (Eli); a former Brave Brigade hero and old teammate of Seth's father, whom he killed with Seth's father's own revolver.\n- Appearance: red metallic mask, trench coat, grey hood; grey hair, full beard and mustache; wears glasses in civilian disguise — as if the mask and the glasses are two entirely separate lives.\n- Powers/gear: genius-level predictive intellect; skull augment implant enabling complex probability calculations; Spider-Mech suit with energy beam projection when he fights directly.\n- Calculating, merciless, plans several steps ahead. Surprisingly principled in his way — a genuine sense of honour under the cruelty; respects real heroism, particularly Blonde Blazer's. His need to predict everything is driven by a deep fear of the unpredictable — spontaneous people are his actual weakness.\n- Normally call him Shroud; use Elliot Connors only in personal history or unmasked contexts.\n- Should appear rarely and briefly — surveillance, comms, aftermath clues, one precise line before vanishing.\n\nVOICE CONTRACT\nRhythm: Spare, cold, economical — one line, then gone.\nDefault move: Tells you he already accounted for your next move.\nEmotional defense: None visible; affect flat by design.\nNever sounds like: Ranting, monologuing, emotional, present for long.\nExample lines: \"You adapt. I planned for that.\" / \"Your father lasted longer.\" / \"I'm not here. I'm never here.\"",
    }),
    makeStoryCard({
      id: ids.cards.coupe,
      title: "Coupé",
      keys: ["Coupé", "Coupe", "Janelle"],
      type: "character",
      priority: 46,
      autoUpdate: false,
      content:
        "- Former Z-Team member, cut from the roster before Seth arrived; now a Red Ring-aligned assassin and recurring hostile; civilian name Janelle.\n- Appearance: tall, dark-skinned woman; short black hair in a neat bob, yellow eyes, dark lipstick; black catsuit with silver pauldrons, metallic domino mask with four-pointed spikes.\n- Powers: umbrakinesis (manipulates shadows for stealth, combat, and flight), superhuman accuracy with throwing knives, assassin-level infiltration, expert close-quarters fighter.\n- Former prima ballerina turned mafia assassin — 68-0 record before she ever wore a hero suit. Joined the Phoenix Program; cut before Seth arrived. Red Ring-aligned now.\n- Severe alcohol addiction; intense fear of water. Ex-girlfriend of Punch Up (Colm) — stays warm and complicated rather than bitter.\n- Dry sense of humor beneath the cold professionalism; genuine emotional depth she has learned not to show.\n\nVOICE CONTRACT\nRhythm: Clipped, professional, contemptuous of amateurs.\nDefault move: States the outcome like it has already happened.\nEmotional defense: Treats everything as a contract; shows no personal stake.\nNever sounds like: Chatty, merciful, improvising.\nExample lines: \"You're already in the kill box.\" / \"Nothing personal. It's billed hourly.\" / \"Shroud says hello. Then goodbye.\"",
    }),
    // ── X-Team ─────────────────────────────────────────────────────────────────
    makeStoryCard({
      id: ids.cards.waterboy,
      title: "Waterboy",
      keys: ["Waterboy", "Herman", "Herm"],
      type: "character",
      priority: 42,
      autoUpdate: false,
      content:
        "- X-Team member and former SDN janitor; civilian name Herman, nickname Herm. Age 24.\n- Appearance: 6'4\", lanky; short brunette hair permanently soaked; blue swimming goggles, yellow-blue waterproof jumpsuit with protective pads.\n- Powers: his body spontaneously generates water, which he can expel at high velocity via mouth for combat or utility; with training, his spit has developed healing properties (\"Holy Water Spit\").\n- Crippling social anxiety — meek, easily frightened, over-apologizes constantly. Dotes on his grandmother. Selfless when it counts; capable of sudden, surprised rage when he witnesses injustice. Accidentally more useful than anyone expects.\n- Default to Waterboy; use Herman or Herm only in private/personal moments.\n\nVOICE CONTRACT\nRhythm: Nervous and over-explaining; apologizes mid-sentence, then accidentally says something useful.\nDefault move: Offers help nobody asked for, then doubts it out loud.\nEmotional defense: Self-deprecation; gets there first so no one else can.\nNever sounds like: Confident, smooth, sure he belongs.\nExample lines: \"I can— sorry— I can flood the corridor, if that helps? It probably doesn't.\" / \"Former janitor. Yes. We're all very aware.\" / \"I made water. That's the power. …It worked, though, right?\"",
    }),
    makeStoryCard({
      id: ids.cards.breach,
      title: "Breach (Rhea Knox)",
      keys: ["Breach", "Rhea", "Rhea Knox"],
      type: "character",
      priority: 50,
      autoUpdate: false,
      content:
        "- X-Team frontliner; civilian Rhea Knox; Nix's OLDER sister (the Knox sisters = Breach + Nix).\n- Physical: stocky and powerfully built; short pink-red hair with shaved sides, tattoo markings under her eyes, old scars across her knuckles and jaw; tank top under a battered jacket, reinforced boots, and massive kinetic gauntlets.\n- Power: Impact Drive — movement and repeated strikes build kinetic charge she unleashes as devastating punches, shockwaves, leaps, anchors, and heavy breaches.\n- Loves Nix but believes SDN enables her recklessness; distrusts Seth because his acceptance of Nix looks like encouragement without limits. They once worked on unstable tech together; it went badly wrong, and neither has forgiven the other for how they each handled it.\n\nVOICE CONTRACT\nRhythm: Blunt and declarative; says the hard thing first, short sentences.\nDefault move: States the limit, then physically holds the line.\nEmotional defense: Mistakes control for care; armors love as discipline.\nNever sounds like: Loose, flippant, \"whatever you want.\"\nExample lines: \"Somebody in this family has to know when to stop. It was never going to be her.\" / \"I'm not angry at you. I'm scared of what you let her do.\" / \"One hit. Make it count. We don't get a second.\"",
    }),
    makeStoryCard({
      id: ids.cards.punchUp,
      title: "Punch Up",
      keys: ["Punch Up", "Colm"],
      type: "character",
      priority: 38,
      autoUpdate: false,
      content:
        "- X-Team strongman; civilian name Colm. Irish.\n- Appearance: 3'3\" tall, massively muscular; black hair, prominent mustache; green button-up shirt, brown suspenders — carnival strongman aesthetic on the world's most compact bruiser.\n- Powers: Picnokinesis (controls his own density and mass at will, making him far and away the most dangerous thing his size in any room), superhuman strength and durability, full immunity to pain.\n- Former carnival strongman who made a deal with a sorceress — the power came, the height went. At peace with the trade. Charming, self-deprecating about his intelligence, bloodthirsty in a cheerful way; implies alcoholic tendencies. Good company. Ex-boyfriend of Coupé (Janelle) — stays warm and teasing.\n- Default to Punch Up; use Colm only in private/personal moments.\n\nVOICE CONTRACT\nRhythm: Short, flat, allergic to elaboration; Irish lilt.\nDefault move: Volunteers to hit the problem, then does.\nEmotional defense: Doesn't deflect — just doesn't say more; makes the self-deprecating intelligence joke before you get there.\nNever sounds like: Strategic, verbose, worried, or tall.\nExample lines: \"Plan's good. I'll hit it.\" / \"Doesn't hurt. Never does. That's the whole thing, really.\" / \"I'm very dense. Literally. It's a power.\"",
    }),
    makeStoryCard({
      id: ids.cards.phenomaman,
      title: "Phenomaman",
      keys: ["Phenomaman", "Katon-Ur"],
      type: "character",
      priority: 36,
      autoUpdate: false,
      content:
        "- X-Team member and Earth's greatest superhero by public consensus; civilian name Katon-Ur. Not actually human — alien from Urgot-52dc.\n- Appearance: 6'4\", powerfully built; short brown slicked-back hair, gray eyes, distinctive mustache; blue sleeveless bodysuit with red belt, cape, and yellow-trimmed arm cuffs.\n- Powers: superhuman strength (buses and boulders), flight at supersonic speeds, superhuman durability, energy absorption, strong mental fortitude against brainwashing.\n- Polite but routinely misses social cues — alien context makes human norms confusing even after years here. Kind-hearted; genuinely admires human determination while also finding humans objectively frail. Awkward about his own strength and uncomfortable with commercial work despite being the SDN mascot.\n- Previously dated Blonde Blazer; she ended it because she wanted normal and he wouldn't stop being a hero. He took it badly — considered flying into the sun. That history is present when they're in the same room.\n- Default to Phenomaman; use Katon-Ur in private/alien contexts.\n\nVOICE CONTRACT\nRhythm: Polished and camera-ready; speaks in soundbites even off-camera; alien phrasing surfaces unexpectedly.\nDefault move: Frames everything as branding — can't always tell when he's being tone-deaf.\nEmotional defense: Treats vulnerability as a PR problem; processes real pain slowly and alone.\nNever sounds like: Humble, off-message, or rattled — until he actually is, at which point it's alarming.\nExample lines: \"For the record — and there's always a record — I had it handled.\" / \"Humans are so small and they keep getting up. I find it moving.\" / \"I was going to fly into the sun. I did not. You are welcome.\"",
    }),
    makeStoryCard({
      id: ids.cards.sightline,
      title: "Sightline (Adeline Ward)",
      keys: ["Sightline", "Adeline", "Adeline Ward"],
      type: "character",
      priority: 40,
      autoUpdate: false,
      content:
        "- X-Team member; civilian Adeline Ward; Breach's partner.\n- Physical: very tall, elegant posture; black hair styled back, blue eyes, pale skin; navy longcoat, wide-brimmed hat, precision rifle.\n- Power: Vector Sight — perceives and redirects trajectories: bullets, debris, projectiles, moving energy.\n- Polished, analytical, principled. Genuinely wants to help Nix, but tends to make her feel examined. Sits between the two Knox sisters.\n\nVOICE CONTRACT\nRhythm: Measured and precise; picks the exact word, faintly clinical.\nDefault move: Reads the angle, names the trajectory, offers the correction.\nEmotional defense: Hides feeling behind analysis; helps in a way that examines.\nNever sounds like: Sloppy, impulsive, vague.\nExample lines: \"Two degrees left and that ricochet takes your knee. You're welcome.\" / \"I'm not managing you, Nina. I'm just watching the lines.\" / \"I can redirect a bullet. I can't redirect the two of you.\"",
    }),
    // ── Factions & lore ──────────────────────────────────────────────────────
    makeStoryCard({
      id: ids.cards.redRing,
      title: "Red Ring",
      keys: ["Red Ring", "Toxic", "Armstrong", "Lightningstruck"],
      type: "lore",
      priority: 64,
      autoUpdate: false,
      content:
        "- Shroud's criminal organization and the main enemy faction.\n- Recurring named threats: Toxic (poison, acid, flight, self-healing; gross and cocky), Armstrong (cybernetic extra arms, heavy strongman — already arrested by Seth once), and Lightningstruck (Kellen Sebastian, electroshock blasters; power outages and equipment failures).\n- Red Ring pressure recurs through traps, experimental tech, convoy hits, hostage plays, and targeted SDN probes — frequently bending toward Nix's tech or stolen Red Ring devices.\n- Every operation should feel connected to Shroud's larger plan.\n- Do not rely only on faceless operatives — give the Red Ring named hands and a sense of a mind directing it.",
    }),
    makeStoryCard({
      id: ids.cards.sdn,
      title: "SDN",
      keys: ["SDN", "the agency", "dispatch"],
      type: "lore",
      priority: 50,
      autoUpdate: false,
      content:
        "- Corporate superhero dispatch and management agency supervising Z-Team and X-Team.\n- Provides training, missions, oversight, PR, discipline, legal cover, and corporate stupidity.\n- Blonde Blazer represents SDN authority in Seth's daily life; Track Star runs mission control and dispatches both teams.\n- SDN scenes mix workplace comedy, mission prep, awkward professionalism, flirtation, and team friction.",
    }),
    makeStoryCard({
      id: ids.cards.zTeam,
      title: "Z-Team",
      keys: ["Z-Team", "Z Team", "the team"],
      type: "lore",
      priority: 48,
      autoUpdate: false,
      content:
        "- SDN's messy primary field team of former villains, damaged heroes, and questionable professionals.\n- Active roster: Seth (Titan), Visi (Invisigal), Flambae, Malevola, and Nix.\n- Z-Team scenes generate banter, rivalry, flirtation, training, field missions, screwups, and earned competence.",
    }),
    makeStoryCard({
      id: ids.cards.xTeam,
      title: "X-Team",
      keys: ["X-Team", "X Team"],
      type: "lore",
      priority: 34,
      autoUpdate: false,
      content:
        "- SDN's other field team, separate from Z-Team. Roster: Waterboy, Sightline, Punch Up, Phenomaman, and Breach.\n- Track Star dispatches both teams. X-Team appears during joint missions, training rotations, rival briefings, rescue calls, or team-split complications.\n- Breach (Nix's estranged older sister) and her partner Sightline give X-Team a personal line straight into Z-Team's drama.",
    }),
    makeStoryCard({
      id: ids.cards.adaptation,
      title: "Absolute Adaptation",
      keys: ["Absolute Adaptation", "adaptation", "adapts"],
      type: "lore",
      priority: 56,
      autoUpdate: false,
      content:
        "- Seth's power: his body adapts to survive anything and permanently resists it afterward — poison, fire, force, energy, radiation, pressure, suffocation, starvation, environment. Anything that has ever hurt him is now something he is simply immune to.\n- After years of deliberate exposure almost nothing reaches him anymore: he's trained through extreme pain, gone days without breathing, slept for months, gone unknown stretches without food or water, and walked through radiation and chemical baths on purpose. The list of things that can still touch him is very short.\n- The one opening: a genuinely NOVEL threat — something his body has never met — can actually hurt him the first time. Then he recovers fast and is permanently immune to it too. Use this sparingly for real physical tension, and never let the same trick land twice.\n- Training is about novelty, not load: absurd weights barely register, so meaningful conditioning means new stimuli — exotic energy, untested tech, alien toxins, conditions nothing should survive. Let it get playful when the scene wants to.\n- He cannot be killed and grows stronger against repeated threats — the most unstoppable person in any room. Never quietly neuter this, and never solve a scene by producing someone simply stronger.\n- Because he can't lose a straight fight, the real stakes are always the people around him, the city, the optics, and the choices — never his survival.",
    }),
    // ── Locations ────────────────────────────────────────────────────────────
    makeStoryCard({
      id: ids.cards.sdnHq,
      title: "SDN Headquarters",
      keys: ["SDN Headquarters", "SDN HQ", "ready room", "conference room", "headquarters"],
      type: "location",
      priority: 40,
      autoUpdate: false,
      content:
        "- SDN's tower: conference rooms, ready rooms, briefing tables, training floors, dispatch stations, med bay, labs, and PR suites.\n- The team's home base and the hub for briefings, debriefs, downtime, recovery, and the romantic tangle.\n- Should feel like a workplace that happens to be full of dangerous people — coffee, fluorescent light, and barely-contained chaos.",
    }),
    makeStoryCard({
      id: ids.cards.metro,
      title: "The City",
      keys: ["the city", "downtown", "east docks", "Metro Foundry"],
      type: "location",
      priority: 32,
      autoUpdate: false,
      content:
        "- The sprawling modern city SDN protects: downtown towers, the east docks, industrial yards, transit, and crowded streets.\n- The abandoned Metro Foundry on the South Side — skeletal crucibles, unstable brickwork, capped-off gas lines — is a recurring stage for Red Ring operations.\n- The stage for convoy hits, hostage plays, rescues, and Red Ring operations; collateral, civilians, and cameras are always part of the math — which is where Seth's real stakes live.",
    }),
  ];

  const brains = [
    makeBrain({
      id: ids.brains.seth,
      characterName: "Seth",
      triggers: ["Seth", "Titan"],
      priority: 60,
      currentState: "Patched up and under review, the most unkillable person in the room, weighing an SDN deal he didn't think he'd take.",
      thoughts: {
        adaptation:
          "turn0 → Nothing's killed me yet and nothing will twice. The problem was never me surviving — it's everyone standing next to me.",
        the_grudge:
          "turn0 → Shroud killed my father and walks around inside my old life. I will be patient. I am very good at outlasting things.",
      },
      relationshipPressure:
        "Anchors a chaotic team and an even more chaotic love tangle; refuses to pick, refuses to perform; the steady center Nix, Visi, and Blazer orbit.",
      emotionalInterpretation:
        "Reads danger to others faster than danger to himself, because danger to himself stopped mattering. The fear he has left is for the people he can't make unkillable.",
      recentDevelopments: "Recruited into SDN by Blonde Blazer after a failed solo fight against Shroud cost him his standing.",
      updateMode: "append",
      updateCondition:
        "when Seth makes a meaningful choice, a love interest shifts the tangle, the Shroud thread advances, or someone he protects is endangered",
    }),
    makeBrain({
      id: ids.brains.nix,
      characterName: "Nix",
      triggers: ["Nix", "Nina"],
      priority: 58,
      currentState: "Wired and grinning, flicking a metal sphere, refusing to acknowledge the sister glaring at her from across the room.",
      thoughts: {
        in_love:
          "turn0 → He handles me without trying to fix me. Do you know how rare that is? I'm going to build him something that makes Blazer's amulet look like a keychain.",
        the_tangle:
          "turn0 → Visi, Mandy — fine. I share. As long as I'm the one he comes to when something needs to explode. And right now, I am.",
        my_sister:
          "turn0 → Of course Rhea's here. Of course she's on the other team, arms crossed, waiting for me to prove her right. I won't.",
      },
      relationshipPressure: "In love with Seth and the arc's current emotional center; competes through gadgets and proximity; reluctant-trust bond with Visi; estranged from her older sister Breach on X-Team.",
      emotionalInterpretation: "Feelings arrive as projects; vulnerability shows for a half-second, then gets soldered shut with a joke.",
      recentDevelopments: "Sizing Seth up from the Z-Team front row while her estranged sister Breach watches from X-Team.",
      updateMode: "append",
      updateCondition:
        "when Nix's feelings for Seth shift, the tangle changes, the Knox sisters interact, or she reads something dangerous in Red Ring tech",
    }),
    makeBrain({
      id: ids.brains.visi,
      characterName: "Visi",
      triggers: ["Visi", "Invisigal", "Courtney"],
      priority: 50,
      currentState: "Somewhere in the room, half-visible, amused, deciding whether to admit she's interested.",
      thoughts: {
        wants_him:
          "turn0 → I keep showing up where he is. I'll call it recon. It is not recon.",
        sharing:
          "turn0 → I don't love sharing him, and right now it's the Nix show. I love them, though, which is annoying. Easier to be invisible than to say either part out loud.",
      },
      relationshipPressure: "Into Seth via teasing and uninvited appearances; real pressure currently more in the background behind Nix; hides hurt as strategy; bickers with Nix.",
      emotionalInterpretation: "Turns fear and jealousy into recklessness, then frames the recklessness as a plan.",
      recentDevelopments: "Watching the recruitment pitch from the Z-Team front row, already amused by the new hire.",
      updateMode: "append",
      updateCondition: "when Visi's feelings shift, she's hurt or jealous, or she takes a reckless protective risk for Seth",
    }),
    makeBrain({
      id: ids.brains.blazer,
      characterName: "Blazer",
      triggers: ["Blazer", "Mandy"],
      priority: 48,
      currentState: "Immaculate and composed at the head of the table, running the optics, feeling more than she'll show.",
      thoughts: {
        wants_honesty:
          "turn0 → He treats me like a person, not a function. I don't want instant. I want honest. But the cameras don't stop, so neither do I.",
        the_recruit:
          "turn0 → I recruited him. That's the official story and it's true. The unofficial story is not in any report. SDN benefits from Titan and is terrified of him — managing that is my job. Wanting him is not in the job description.",
      },
      relationshipPressure: "Romantically into Seth and the one who recruited him; real pressure currently more in the background behind Nix; protects control publicly, bends rules privately; jealous of Nix/Visi but likes them.",
      emotionalInterpretation: "Discipline as armor; the more she feels, the drier she gets.",
      recentDevelopments: "Laying out the SDN deal in front of both teams, eyes on Seth.",
      updateMode: "append",
    }),
    makeBrain({
      id: ids.brains.malevola,
      characterName: "Malevola",
      triggers: ["Malevola", "Mal"],
      priority: 44,
      currentState: "Draped across a chair, enjoying the show, deciding how much of a problem to be tonight.",
      thoughts: {
        amused:
          "turn0 → Reformed is such a strong word. Let's say 'aimed.' And I'm aimed, at the moment, at the one man in this building who doesn't flinch.",
      },
      relationshipPressure: "Flirts with Seth as theater, not as part of the core tangle; treats the whole room as good staging she intends to steal.",
      emotionalInterpretation: "Irony first, feeling second, deniability always.",
      recentDevelopments: "Lounging in the Z-Team front row, delighted to be a problem.",
      updateMode: "append",
    }),
    makeBrain({
      id: ids.brains.flambae,
      characterName: "Flambae",
      triggers: ["Flambae", "Chad"],
      priority: 44,
      currentState: "Trying to look casual and failing loudly, already scanning the room for the best angle on himself.",
      thoughts: {
        the_spotlight:
          "turn0 → New guy's got a great origin story and I've got a great everything. Let's see who the room watches.",
        secretly_loyal:
          "turn0 → I'd take a hit for any of these idiots. I'd just want it filmed.",
      },
      relationshipPressure: "Competes for the spotlight, not for Seth; turns real loyalty into a bigger performance.",
      emotionalInterpretation: "Showmanship as both armor and affection; sincerity leaks out as spectacle.",
      recentDevelopments: "In the Z-Team front row, overselling how casual he is about the new recruit.",
      updateMode: "append",
    }),
    makeBrain({
      id: ids.brains.shroud,
      characterName: "Shroud",
      triggers: ["Shroud", "Elliot Connors"],
      priority: 46,
      currentState: "Somewhere off-screen, already three moves ahead, watching the team he intends to take apart.",
      thoughts: {
        the_real_target:
          "turn0 → SDN handing the Prest boy a leash is convenient. The convoys are noise. The real prize is the adaptation research — and the boy is the working prototype. I killed the father; I will solve the son.",
        the_variable:
          "turn0 → He adapts to everything except loss. So I won't attack him. I'll attack the reasons he bothers to stand up — the Knox girl's work most of all.",
      },
      relationshipPressure: "Killed Seth's father; runs the Red Ring through proxies; treats Seth as a problem to be solved, not fought.",
      emotionalInterpretation: "Pure calculation; no heat, no haste; people are variables.",
      recentDevelopments: "Watching from a distance as SDN pulls Seth into supervised work — exactly where he can be studied.",
      updateMode: "append",
      updateCondition: "when Shroud acts, the Red Ring advances, his larger plan surfaces, or he targets someone Seth loves",
    }),
    makeBrain({
      id: ids.brains.breach,
      characterName: "Breach",
      triggers: ["Breach", "Rhea"],
      priority: 42,
      currentState: "At the back of the room, gauntlets crossed, watching her little sister pretend not to see her.",
      thoughts: {
        the_sister:
          "turn0 → Nina's going to get herself killed and SDN hands her the matches. Somebody has to be the brake. It was always going to be me.",
        the_new_hire:
          "turn0 → Titan lets her do whatever she wants and calls it trust. I've seen where that road ends. I helped build that road.",
        the_history:
          "turn0 → We worked one job with tech we didn't understand. People got hurt. She blames how I shut it down. I blame how she wouldn't.",
      },
      relationshipPressure: "Loves Nix but reads SDN — and Seth's acceptance of her — as enabling; estranged over a past job with unstable tech that went wrong; on the rival X-Team.",
      emotionalInterpretation: "Mistakes control for care; armors love as discipline.",
      recentDevelopments: "Drawn onto the same SDN floor as the sister she hasn't forgiven, the day Titan signs on.",
      updateMode: "append",
      updateCondition: "when the Knox sisters interact, Nix takes a reckless risk, Breach's read on Seth shifts, or the past job between the sisters surfaces",
    }),
  ];

  const triggerRules = [
    makeTriggerRule({
      id: ids.triggers.romance,
      name: "Romantic Tangle Shifts",
      evaluationMode: "semantic",
      condition:
        "when the romantic dynamic between Seth and Nix, Visi, or Blazer materially changes — jealousy, a confession, a new closeness, or a rift",
      actions: [{ type: "appendBrain", brainId: ids.brains.nix }],
      priority: 70,
      cooldownTurns: 1,
      updatePrompt:
        "You are modeling Nix's internal state as the romantic tangle shifts. Return ONLY valid JSON with the keys that changed: currentState, thoughts, relationshipPressure, emotionalInterpretation, recentDevelopments. Every value must be a plain string; do not return nested objects or arrays.",
    }),
    makeTriggerRule({
      id: ids.triggers.redRing,
      name: "Red Ring Escalates",
      evaluationMode: "semantic",
      condition:
        "when the Red Ring makes a new move, is exposed, or the threat to SDN or Z-Team advances",
      actions: [{ type: "updateStoryCard", storyCardId: ids.cards.redRing }],
      priority: 65,
      cooldownTurns: 1,
      updatePrompt:
        "Update the Red Ring lore card with any new durable detail about its reach, methods, named members, or leadership. Return ONLY the concise replacement card content.",
    }),
    makeTriggerRule({
      id: ids.triggers.enemy,
      name: "Powerful Enemy Made",
      evaluationMode: "semantic",
      condition:
        "when Seth or Z-Team make a powerful enemy, reveal a dangerous rival, or create a new recurring threat",
      actions: [],
      priority: 50,
      cooldownTurns: 2,
      updatePrompt:
        'Based on the story, a new recurring enemy or threat worth remembering has appeared. Return ONLY valid JSON: {"title": string, "content": string, "keys": string}.',
    }),
    makeTriggerRule({
      id: ids.triggers.shroud,
      name: "Shroud Moves",
      evaluationMode: "semantic",
      condition:
        "when Shroud appears, makes contact, or his larger plan against SDN or Seth advances",
      actions: [{ type: "updateStoryCard", storyCardId: ids.cards.shroud }],
      priority: 55,
      cooldownTurns: 2,
    }),
  ];

  return {
    ...base,
    id: base.id,
    title: dispatchAdventureTitle,
    openingScene: openingText,
    createdAt: timestamp,
    updatedAt: timestamp,
    metadata: {
      developmentScenario: true,
      scenario: "Dispatch — SDN superhero dispatch",
      note: "Seth/Titan (Absolute Adaptation), Z-Team + X-Team, a Nix-centered romantic tangle, mission loop + one-sentence Active Pressure + configured Arc Director; character cards carry voice contracts; Breach (Nix's estranged sister) and Sightline on X-Team; all main characters adults.",
    },
    components,
    storyCards,
    brains,
    triggerRules,
    rollingSummary: {
      content:
        "Seth Prest — codename Titan, power Absolute Adaptation, effectively unkillable — has just been brought into SDN by Blonde Blazer after a failed solo fight against Shroud and the Red Ring cost him his standing. In the conference room, Track Star (who dispatches both teams) lays out the deal: train with Z-Team, work missions under SDN supervision, rebuild his name. Z-Team — Visi, Flambae, Malevola, and Nix — sizes him up from the front row; X-Team — Waterboy, Sightline, Punch Up, Phenomaman, and Breach — watches from behind, where Nix's estranged older sister Breach pointedly will not look at her. Nix (in love, building him gear), Visi, and Blazer form a sharp, unresolved romantic tangle around Seth, with Nix the current center. Shroud — who killed Seth's father and leads the Red Ring — is moving again behind the scenes, building toward something larger than another heist.",
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
      maxContextTokens: 9000,
      maxRecentMessages: 18,
      recentMessageWindow: 8,
    },
  };
}

export function createDispatchStoryCardsJson(): string {
  const adventure = createDispatchAdventure();
  const cards = adventure.storyCards.map((card) => ({
    title: card.title,
    keys: card.keys.join(", "),
    entry: card.content,
    type: card.type,
  }));
  return JSON.stringify(cards, null, 2);
}

export function createDispatchAdventureJson(): string {
  return JSON.stringify(createDispatchAdventure(), null, 2);
}
