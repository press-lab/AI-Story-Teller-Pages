# Edit Surface UI Treatment

This app wants two things that usually fight each other: every authoring control should stay available, but the screen should feel calm enough to scan. The current treatment resolves that by making list views behave like directories and reserving full visual weight for the thing the user is actively editing.

## Principles

- Start each edit page with a short page summary and small count pills. The user should know what surface they are in and how many things matter before seeing forms.
- Put search and primary creation actions in one sticky command bar near the top.
- Show authored items as dense rows by default: title first, then badges, trigger keys or aliases, then one useful preview line.
- Expand only the selected item into the full editor. The closed rows remain visible so switching between items does not feel like losing the list.
- Group conceptually different work into separate panels instead of one long control pile.
- Keep advanced, historical, and diagnostic material in details panels unless it is the main job of the page.
- Keep the most important fields first inside expanded editors: identity, trigger/alias keys, content/thought history, then automation/settings.

## Current Application

- Plot groups components into Core Story Contract, Current Story State, and Extra World Blocks.
- Story Cards use dense rows that surface title, type/status, trigger keys, and a content preview before opening the full editor.
- Characters use cast rows that surface name, aliases, thought count, and latest active thought before opening the full editor.
- Memory Suggestions, Automation, Chronicle, Context, Saves, Import / Export, and Settings should follow the same page-summary plus grouped-work pattern.

## When Adding New Edit Screens

Use `editor-surface`, `editor-page-summary`, `editor-command-bar`, dense `details` rows, and grouped panels from `src/styles.css` before introducing new layout classes. If a page needs many controls, split them by user intent rather than implementation detail. The goal is not fewer controls; it is fewer controls screaming at the same time.
