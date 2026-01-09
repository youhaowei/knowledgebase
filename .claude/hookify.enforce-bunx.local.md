---
name: enforce-bunx
enabled: true
event: bash
pattern: \bnpx\s+
action: block
---

**Use bunx instead of npx!**

This project uses Bun. Replace your command:

| Instead of             | Use                     |
| ---------------------- | ----------------------- |
| `npx <package> <cmd>`  | `bunx <package> <cmd>`  |
| `npx create-react-app` | `bunx create-react-app` |
| `npx prisma generate`  | `bunx prisma generate`  |

bunx is faster and uses Bun's package resolution.

See CLAUDE.md for full Bun usage guidelines.
