---
name: enforce-bun-runtime
enabled: false
event: bash
pattern: ^\s*(node|ts-node)\s+"?(?!/)\S+\.(js|ts|mjs|cjs)
action: block
---

**Use Bun instead of Node.js!**

This project uses Bun as the runtime. Replace your command:

| Instead of        | Use           |
| ----------------- | ------------- |
| `node file.js`    | `bun file.js` |
| `node file.ts`    | `bun file.ts` |
| `ts-node file.ts` | `bun file.ts` |

Bun natively supports TypeScript - no transpilation needed!

See CLAUDE.md for full Bun usage guidelines.
