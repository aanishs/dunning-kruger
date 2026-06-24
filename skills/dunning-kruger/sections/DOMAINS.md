# DOMAINS — name the vault's communities (YOU are the namer)

`dk vault` builds the graph and clusters it into communities, but leaves them **numbered**
("Community 0" .. "Community N"). The clustering is deterministic graph math; the *name* is a
judgment call — and that's your job. You're the model already reading this code, so naming the
clusters costs no API key. (This step is skill-mode only. The standalone `dk vault` leaves domains
numbered unless run with `--smart`, which shells to the user's own `claude -p` / `codex`.)

You NAME; `dk name-domains` REWRITES. Never hand-edit the vault files.

After `dk vault <repo>` succeeds:

1. **Read the communities.** Each `<vault>/_COMMUNITY_*.md` note lists its members (functions /
   files) with their source paths. Read them.
2. **Name each by what it DOES**, not by folder — "Auth", "Billing", "Scheduling", "Notes",
   "Patient Management". Group by responsibility. A cluster that's mostly tests / utils / glue is
   "Plumbing" or similar — honest over cute. A name should tell the user what lives there. Omit any
   community you can't confidently name (leave it numbered).
3. **Write the mapping** as JSON keyed by the community's *current* name, e.g.:
   ```json
   { "Community 6": "Auth", "Community 3": "Notes", "Community 11": "Billing" }
   ```
   Save it to a temp file (e.g. `/tmp/dk-domains.json`).
4. **Apply it deterministically:**
   ```
   dk name-domains <vault> /tmp/dk-domains.json
   ```
   That rewrites the `community/<id>` tags, the `community:` frontmatter, the `_COMMUNITY_` index
   notes (content + filename), the `graph.canvas` group labels, and the `.obsidian/graph.json`
   color groups — in one pass. It reports how many matched; unmatched keys mean the community was
   already renamed or doesn't exist (a no-op, not an error).

Then tell the user: open the vault's **Graph view** (their comprehension colors) and the
**Canvas** (`graph.canvas`) — the canvas now shows their code laid out by *named* domain.
