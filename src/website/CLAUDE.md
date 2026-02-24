# Website

Vite + React 19 public marketing site.

## Commands

```bash
# Dev server (port 3001)
npm run dev

# Production build
npm run build
```

## Styling

- **Shared tokens**: Imported via the `@shared` path alias (configured in `vite.config.ts` and `tsconfig.json`). Points to `src/shared/styles/`.
- **Global CSS**: `@shared/styles/global.css` is imported in `main.tsx`. Defines CSS custom properties and global base styles.
- **MUI theme**: `src/theme.ts` builds the Material UI theme from shared tokens (`@shared/styles/tokens`). Matches the webapp theme for brand consistency.
- **Component styling**: MUI `sx` prop. All colours should reference the theme palette or shared tokens — avoid hardcoded colour values.

## Pages

- **Home** (`/`) — Hero, social proof, feature highlights, CTA
- **Features** (`/features`) — Categorised feature breakdown, "Why no-code?" section
- **Pricing** (`/pricing`) — Starter / Pro / Enterprise tiers, FAQ

## Layout

- `MarketingLayout` — Sticky navbar with navigation links and Sign in / Get started CTAs, footer with brand, product links, and account links. Mobile-responsive with hamburger drawer.
