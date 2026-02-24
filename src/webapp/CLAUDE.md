# Webapp

Vite + React 19 authenticated dashboard (Cognito-gated).

## Commands

```bash
# Dev server
npm run dev

# Production build
npm run build
```

## Styling

- **Shared tokens**: Imported via the `@shared` path alias (configured in `vite.config.ts` and `tsconfig.json`). Points to `src/shared/styles/`.
- **Global CSS**: `@shared/styles/global.css` is imported in `main.tsx`. Defines CSS custom properties and global base styles.
- **MUI theme**: `src/theme.ts` builds the Material UI theme from shared tokens (`@shared/styles/tokens`).
- **Monospace font**: JetBrains Mono (loaded from Google Fonts in `index.html`). Use `typography.fontFamily.mono` from tokens.
- **Component styling**: MUI `sx` prop. All colours should reference the theme palette or shared tokens — avoid hardcoded colour values.
