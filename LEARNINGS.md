# Learnings

Simple learnings discovered during development that document how things actually work.

## Extension Icons

- `.ico` files don't work as extension icons; use `.png` files instead

## Content Script Styling

- **Shadow DOM**: Don't use for Vue components - Vue injects `<style>` tags into `document.head`, not the shadow root, so styles won't apply to the template
- **Tailwind CSS**: Don't use for content script components - CRXJS + Tailwind JIT has horrible DX (requires dev server restart for new classes, or styles leak to host page)
- **CRXJS HMR**: Works for template/script changes, but broken for ALL styles (Tailwind, Vue `<style>` tags, AND imported CSS files) - any style change requires dev server restart. Only inline styles in template work with HMR.
- **Solution**: Use Vue `<style scoped>` for isolation; accept poor DX or use a standalone dev playground for iterating on styles
