---
name: warn-eslint-disable
enabled: true
event: file
pattern: eslint-disable|@ts-ignore|@ts-nocheck|@ts-expect-error
action: warn
---

**Lint suppression comment detected!**

You're adding a comment that suppresses linting or type checking:

- `eslint-disable` - Disables ESLint rules
- `@ts-ignore` - Ignores TypeScript errors
- `@ts-nocheck` - Disables type checking for file
- `@ts-expect-error` - Expects a TypeScript error

**Best practices:**

1. Fix the underlying issue instead of suppressing it
2. If suppression is necessary, use the most specific form:
   - `eslint-disable-next-line specific-rule` (not blanket disable)
   - Add a comment explaining WHY it's needed
3. Consider if the ESLint rule should be configured differently in `.eslintrc`

**Ask yourself:** Is this suppression truly necessary, or is there a better solution?
