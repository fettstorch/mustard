# Agent Rules

Specialized domain knowledge lives as skills in `.agents/skills/`
(`cross-browser-webext`, `atproto-supabase-auth`, `mustard-architecture`). Their
descriptions are always in context and tell you when to load the full skill — so
read the matching one before non-trivial work in that area. When you discover a
new learning, extend the relevant skill rather than starting a separate doc.

## Research Before Suggesting

**CRITICAL**: Before suggesting any technical approach or third-party service, you MUST research whether it actually works for the specific problem:

- Search for known issues, limitations, and gotchas
- Verify the service/tool supports the specific use case (e.g., "does X support serving HTML?", "does Y work with Chrome extensions?")
- Check official documentation for limitations
- Look for Stack Overflow/GitHub issues about the specific problem

Do NOT suggest solutions based on assumptions. Wasting the user's time on approaches that don't work is unacceptable.

## Product & Strategic Decisions

**IMPORTANT**: For product and strategic decisions, always read and reference the `README.md` file, specifically the "Project Vision" section. This contains the project goals, MVP scope, and strategic direction that should guide all implementation decisions.
