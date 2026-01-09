---
name: require-eslint-before-stop
enabled: true
event: stop
pattern: .*
action: warn
---

**Before completing this task, ensure ESLint has been run!**

Run the linter to catch any issues:

```bash
bun run lint
# or
bunx eslint .
```

**Checklist:**

- [ ] ESLint ran without errors
- [ ] Any warnings reviewed and addressed
- [ ] No new lint-disable comments added without justification

If lint was already run and passed, you may proceed.
