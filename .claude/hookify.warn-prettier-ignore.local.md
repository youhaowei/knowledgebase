---
name: block-prettier-ignore
enabled: true
event: file
pattern: prettier-ignore|format-ignore
action: block
---

**BLOCKED: Prettier ignore comment detected!**

You're adding a comment that disables Prettier formatting:

- `prettier-ignore` - Disables formatting for next line/block
- `format-ignore` - Alternative formatting ignore

**This is blocked because:**

1. Consistent formatting improves code readability
2. Ignoring formatting leads to inconsistent codebase
3. If Prettier produces bad output, the config should be fixed

**Instead of ignoring:**

- Adjust `.prettierrc` configuration if the rule is problematic
- Use Prettier's official options for edge cases
- Discuss with the team if a pattern needs different handling

Remove the ignore comment and let Prettier format the code.
