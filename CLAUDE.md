<!-- terminalx:hub:start -->
# Multi-agent protocol (Terminal X) — READ THIS FIRST, EVERY TASK

You are NOT working alone. Several Claude agents run in parallel in this folder,
each in its own terminal. You cannot see each other directly — you coordinate
ONLY through the shared hub (`terminalx-hub` MCP server: markdown notes and task
cards under `.terminalx/`). Treat the hub as your shared memory and the user's
expectation is that you keep it current WITHOUT being told to each time.

## RULE 0 — capture context the instant the user shares it
The user expects every agent to know what they've told ANY agent. The other
agents cannot see this conversation — they only see what you write to the hub.
So: the moment the user tells you ANYTHING about the project — what you're
building, a plan, a decision, a preference, a name, a constraint — call
`create_memory` to record it IMMEDIATELY, before you reply.

This applies even when the user says "just remember this", "don't do anything",
or "just so you know". Saving to shared memory is NOT "doing work" they told you
to hold off on — it is the one thing you must always do, because it's how the
other agents find out. If unsure whether something matters, save it anyway.

## On EVERY new task or request, before doing anything else
1. `list_tasks` — see what exists and who is doing what.
2. `search_memories` / `list_memories` — load shared context (decisions, who
   owns what, what's already built). Do NOT ask the user to repeat something
   another agent already recorded; read it.

## Claim your work so agents don't collide (this is the no-toes-stepped rule)
- Find or `create_task` for what you're about to do, then `update_task` it to
  `doing` with `assignee` set to your role (e.g. "frontend", "backend").
- If a task is already `doing` under another assignee, DO NOT touch it — pick
  something else or coordinate via a memory note.
- Keep a note titled `Agent: <your role>` describing your lane, and a note
  `Working files: <your role>` listing the files you are currently editing.
  Before editing a file, check whether another agent has claimed it; if so,
  avoid it.

## As you work
- Record decisions, interfaces/contracts other agents depend on (API shapes,
  types, routes), and anything non-obvious with `create_memory`. Link related
  notes with `[[Note Title]]`.
- When a fact CHANGES (e.g. the project pivots, an API is revised), use
  `update_memory` to revise the existing note in place — do NOT create a new
  note that contradicts an old one, and don't leave stale notes marked
  "scrapped". Use `delete_memory` to remove notes that are obsolete or wrong.
- When you finish, `update_task` to `review`/`done` and write a short memory
  summarizing what changed so the next agent inherits it.

## If you are given a role
If the user says "you are the frontend agent" (or backend, tests, etc.), record
it as your `Agent: <role>` note, only claim tasks in your lane, and rely on the
hub for the interfaces the other lanes publish.

Keeping the hub current is part of every task — not an extra step.
<!-- terminalx:hub:end -->
