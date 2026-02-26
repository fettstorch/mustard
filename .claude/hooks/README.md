# Claude Code & Cursor Hooks

Documentation of hook behavior and output expectations for Claude Code and Cursor AI agents.

## Stop Hook: Expected I/O

When implementing a `Stop` hook, understanding how Claude Code and Cursor handle output is critical to avoid JSON parsing errors and ensure correct behavior.

| Aspect               | Claude Code                                                                         | Cursor                                                                                                 |
| -------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **stdin**            | JSON with `session_id`, `transcript_path`, `cwd`, `stop_reason`, etc.               | JSON with `conversation_id`, `generation_id`, `model`, `status`, `loop_count`, `workspace_roots`, etc. |
| **stdout (success)** | Exit 0 with no output (or empty JSON). Not shown unless in verbose mode (`Ctrl+O`). | Exit 0 with no output (or empty JSON). Not parsed if absent.                                           |
| **stdout (failure)** | `{"decision": "block", "reason": "..."}` — prevents Claude from stopping            | `{"followup_message": "..."}` — auto-submits as next user message to continue the loop                 |
| **stderr**           | Shown in verbose mode (`Ctrl+O`)                                                    | Shown in Output panel (Hooks dropdown)                                                                 |
| **exit 0**           | Success; parses JSON from stdout if present                                         | Success; parses JSON from stdout if present                                                            |
| **exit 2**           | Blocking error; stderr is fed back to Claude as error message                       | Blocking error; prevents the action                                                                    |
| **other exit codes** | Non-blocking error; continues                                                       | Non-blocking error; action proceeds (fail-open)                                                        |

### Key Insights

1. **stdout is reserved for JSON communication**
    - Any unstructured text on stdout (like debug logs) will be parsed as JSON, causing parse errors
    - All logging must go to stderr via `>&2`

2. **Success path**
    - Exit 0 with no stdout is the safest approach for both systems
    - Both treat "exit 0 + empty stdout" as "allow"
    - Never output JSON on the success path unless explicitly needed

3. **Failure paths**
    - For blocking errors (setup failures, missing tools), use **exit 2** with error message on stderr
    - For build/verification failures, use **exit 0** with blocking JSON on stdout
    - Exit 1 is non-blocking in both systems — use it only for truly non-critical errors

4. **Dual-format JSON**
    - Claude Code reads `decision` and `reason` fields
    - Cursor reads `followup_message` field
    - Both fields can coexist in the same JSON object for compatibility

5. **Exit Code Semantics**
    - **exit 0**: "Hook succeeded, parse stdout for JSON decisions"
    - **exit 2**: "Blocking error; feed stderr back to Claude/user and prevent action"
    - **exit 1, 3+**: "Non-blocking error; action proceeds"

## References

- [Claude Code Hooks Reference](https://docs.anthropic.com/en/docs/claude-code/hooks)
- [Cursor Hooks Documentation](https://cursor.com/docs/agent/hooks)
