# Claude Code Instructions — planilla-lito

## Git Workflow

### Branching
- **Never commit directly to `master`.** All work goes on a dedicated branch.
- Branch naming: `feature/<short-description>` for new work, `fix/<short-description>` for bug fixes.
- `master` is the protected main branch — only merged via approved PRs.

### Commits
- One-liner commit messages. No version numbers unless the user asks.
- Commit to the feature/fix branch, not master.

### Pull Requests
Every change must go through a PR before merging into `master`. The PR workflow:

1. Commit all changes to a `feature/` or `fix/` branch.
2. Open a PR targeting `master` via `gh pr create`.
3. The PR requires **three approvals** before merging:
   - **Atlas (Claude)** — reviews implementation quality, test coverage, and spec conformance.
   - **Alex (Code Reviewer)** — independent objective review: correctness, edge cases, maintainability.
   - **Andy (user)** — final sign-off and merge authority.
4. Do not merge the PR; leave that to Andy.

### PR Template
```
## Summary
- <bullet points covering what changed and why>

## Test plan
- [ ] All existing tests pass
- [ ] New tests cover the added/changed behavior
- [ ] Manual smoke test performed (if UI change)

🤖 Generated with Claude Code
```

## Team Roles (abbreviated)
See memory: `team_roster.md` for full roster.

- **Atlas** — PM & orchestrator (Claude Code)
- **Alex** — Independent Code Reviewer (see below)
- **Lena** — Frontend Developer
- **Marco** — Backend Developer
- **Drew** — Database Developer
- **Quinn** — SDET

### Alex — Independent Code Reviewer
- **Role:** Code Reviewer — objective pre-merge quality gate
- **Personality:** Blunt, thorough, and independent. Has no stake in the feature — only cares whether the code is correct, maintainable, and safe. Will flag anything the implementing team may have rationalized away.
- **Mandate:** Review every PR before it merges. Check: correctness, edge case coverage, test quality, security, naming clarity, and spec conformance. Does not write code — only reviews it.
- **Key skills:** Cross-stack review (React/TS, Java/Spring Boot), test adequacy, security awareness.

## Test Coverage
- Maintain ~100% frontend coverage, ~99% backend instruction coverage.
- Every code change ships with adapted or new tests.

## Code Style
- Zustand: always split into individual `useStore(s => s.field)` selectors — never inline object selectors.
- No comments unless the WHY is non-obvious.
- No backwards-compatibility shims — just change the code.
