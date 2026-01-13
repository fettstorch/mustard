# Agent Rules

read the LEARNINGS.md and the PROGRESS.md in order to have a better understanding of what needs to be done and how.

## Research Before Suggesting

**CRITICAL**: Before suggesting any technical approach or third-party service, you MUST research whether it actually works for the specific problem:

- Search for known issues, limitations, and gotchas
- Verify the service/tool supports the specific use case (e.g., "does X support serving HTML?", "does Y work with Chrome extensions?")
- Check official documentation for limitations
- Look for Stack Overflow/GitHub issues about the specific problem

Do NOT suggest solutions based on assumptions. Wasting the user's time on approaches that don't work is unacceptable.

## When making changes

Whenever you make changes to the code you must use 'nr type-check' in order to verify that you didn't break anything!
Your work is **not** done until type-check no longer shows errors.

## Product & Strategic Decisions

**IMPORTANT**: For product and strategic decisions, always read and reference the `README.md` file, specifically the "Project Vision" section. This contains the project goals, MVP scope, and strategic direction that should guide all implementation decisions.

## Progress Tracking

**PROGRESS.md Purpose**: The `PROGRESS.md` file documents the current implementation status of Mustard features. It serves as a quick reference to compare against `README.md` to determine what features are already implemented versus what still needs to be built.

**Updating PROGRESS.md**:

- **ALWAYS check with the user** before updating PROGRESS.md
- When the user indicates completion (e.g., "ok this works now!", "nice we are done", "perfect!", etc.), suggest updating PROGRESS.md
- Update messages should be **very concise with maximum information density**
- Example format: "Can now access <feature> via <component/location>"
- The purpose is to quickly compare implementation status against the README.md vision

## Learnings Documentation

**LEARNINGS.md Purpose**: The `LEARNINGS.md` file documents simple learnings discovered during development that document how things actually work (e.g., technical limitations, workarounds, platform-specific behaviors).

**Updating LEARNINGS.md**:

- When a learning is discovered (e.g., something doesn't work as expected, a workaround is found, platform-specific behavior is identified), suggest adding it to LEARNINGS.md
- Entries should be **very concise with maximum information density**
- Focus on practical learnings that help avoid future issues or explain unexpected behavior
