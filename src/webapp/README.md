# Webapp

Authenticated dashboard SPA for No-code Bot Trading, gated by Cognito.

## Tech Stack

- **React 19** + **TypeScript**
- **Vite** — dev server and bundler
- **Material UI 6** — component library
- **MUI X Charts** — LineChart, BarChart, PieChart, SparkLineChart
- **React Router 7** — client-side routing
- **AWS Amplify 6** — Cognito authentication

## Development

```bash
npm install
npm run dev      # Start Vite dev server on port 5173
npm run build    # Production build to dist/
npm run preview  # Preview production build
```

## Environment Variables

Create a `.env.local` file with:

```
VITE_COGNITO_USER_POOL_ID=ap-southeast-2_xxxxx
VITE_COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
VITE_API_URL=https://xxxxxxxxxx.execute-api.ap-southeast-2.amazonaws.com/prod
```

## Project Structure

```
src/
├── main.tsx              # Entry point — Amplify config + ReactDOM render
├── App.tsx               # Router setup with theme provider
├── theme.ts              # Dark trading theme (blue primary, Inter font)
├── amplify.ts            # AWS Amplify / Cognito configuration
├── components/
│   ├── AuthGuard.tsx     # Auth gate — redirects unauthenticated users
│   └── StatCard.tsx      # Dashboard stat card with sparkline chart
├── data/
│   └── mockData.ts       # Mock trading data (stats, trades, portfolios, orderbook)
├── layouts/
│   └── DashboardLayout.tsx  # Sidebar + content layout (no desktop AppBar)
└── pages/
    ├── SignIn.tsx         # Split sign-in page (branding + form)
    ├── Dashboard.tsx      # Stats, performance chart, volume chart, recent trades
    ├── Portfolios.tsx     # Portfolio cards, allocation pie chart, holdings table
    └── Orderbook.tsx      # Buy/sell tables, depth chart, recent fills
```
