---
name: enforce-bun-package-manager
enabled: true
event: bash
pattern: \b(npm|yarn|pnpm)\s+(install|run|exec|init|add|remove|ci|update|publish)
action: block
---

**Use Bun instead of npm/yarn/pnpm!**

This project uses Bun as the package manager. Replace your command:

| Instead of         | Use                |
| ------------------ | ------------------ |
| `npm install`      | `bun install`      |
| `npm run <script>` | `bun run <script>` |
| `yarn add <pkg>`   | `bun add <pkg>`    |
| `pnpm install`     | `bun install`      |

See CLAUDE.md for full Bun usage guidelines.
