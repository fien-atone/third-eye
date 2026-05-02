# Agent JSONL fixtures

Synthetic spherical-cow JSONLs covering the parser's branches.
Every file is hand-crafted minimum: enough lines to exercise one
specific code path, nothing extra. NOT real session data.

| File | Scenario |
| --- | --- |
| `with-agent-type.jsonl` + `.meta.json` | meta.json has `agentType` (modern Claude Code) — should detect role 'frontend-dev' with confidence 'meta' |
| `with-description-prefix.jsonl` + `.meta.json` | meta.json has only `description` starting with "role:" — legacy detection path |
| `you-are-the-x.jsonl` | No meta.json sibling, first user message contains "You are the qa" — prompt-regex detection |
| `no-role-signal.jsonl` | No meta, no recognizable prompt — should fall through to 'unknown' |
| `corrupt-meta.jsonl` + `.meta.json` (broken JSON) | meta.json is malformed — parser must NOT crash, must fall back to other detection signals |
| `empty-tokens.jsonl` | All assistant turns yielded zero tokens — validity gate should reject (returns null) |

Token counts and timestamps are fake but plausible — chosen so the
math results land on round numbers we can assert against.
