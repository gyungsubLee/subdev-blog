---
name: project-context
description: Start or hand off isolated task context in this checkout; verify clone/worktree initialization before resuming.
---

Read the shared implementation at `~/.codex/skills/project-context/SKILL.md` directly;
do not recursively invoke this local bridge. Resolve CODEX_HOME when customized.
Read this root's `.project-context/INDEX.md` and only the named task handoff.
Run its helper `check --root <actual-working-root>` before resuming.
Existing AGENTS, CONTEXT, design documents and project skills remain authoritative.
Never load another checkout's task state or global handoff history.
