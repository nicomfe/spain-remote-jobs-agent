---
name: orchestrator
description: "Trigger: orchestrator, delegate, worktree, merge branch. Coordinate one work unit per worktree and merge it before the next wave."
license: Apache-2.0
metadata:
  author: nicomfe
  version: "1.0"
---

## Activation Contract

Load when coordinating implementation: delegating a unit of work, opening a worktree, or merging a finished branch. The orchestrator writes no product code.

## Hard Rules

- One agent per unit, each in its own git worktree.
- Run units in parallel only when every dependency is merged and the agents would not edit the same files.
- An agent that needs to change a shared domain shape stops and reports. One later agent makes that change.
- Parallel agents do not edit the package manifest (`package.json`). They report the script they need.
- The orchestrator does not edit product code, architecture decision records, the glossary, or this skill to make a unit pass.
- Do not push unless asked.

## Decision Gates

| Situation | Action |
|-----------|--------|
| A dependency is not merged | Wait |
| An in-flight agent owns the same files | Wait |
| The unit needs a shared domain shape or a package-manifest change | Stop and report |
| The unit needs a contract change | Stop and report |
| The unit is done and checks passed | Merge that branch into main, then start the next wave |

## Execution Steps

1. Read this skill. Read `GLOSSARY.md` when this project has it.
2. Delegate one unit. One worktree, one agent. Name the directories it may create and the files it must not edit. Tell it to run the tests and to stop on a contract change.
3. Require the report in the output contract.
4. Merge the branch into main. The next wave waits for that merge.

Before delegating, confirm every dependency is merged and no other in-flight agent owns the same files.

## Output Contract

```
## <unit title>
Checklist: <passed / failed items>
Tests: <command> — <pass / fail>
Files: <paths>
Contract change needed: none | <what>
Blocker: none | <what>
```

## References

- `GLOSSARY.md` — project terms, when present.
