---
name: require-prettier-before-stop
enabled: true
event: stop
pattern: .*
action: block
---

**BLOCKED: Run Prettier before completing this task!**

You must format code before finishing:

```bash
bun run format
# or
bunx prettier --write .
```

**Checklist:**

- [ ] Prettier ran on all modified files
- [ ] No formatting errors remain
- [ ] Code is consistently formatted

Run the formatter and try again.
