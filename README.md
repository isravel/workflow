# WorkFlow Journal

The frontend for a personal visual work journal. The application lives in `app/` beside the product specifications.

## Commands

Run these from `app/` with Node 20.11 or newer:

```bash
npm run dev
npm run lint
npm run typecheck
npm run stylelint
npm run build
npm run test:unit
npm run test:e2e
npm run test:e2e:pwa
```

The app uses Next.js 16.3.3, React 19, TypeScript strict mode, Sass modules, and static export. Activities and tasks are persisted in browser `localStorage` by default. To share the same journal data between browsers on one computer, run the separate `../data-app` service and add this to `.env.local`:

```env
NEXT_PUBLIC_ACTIVITY_API_URL=http://127.0.0.1:7001
```

Use the Settings backup controls before clearing browser data. The supported browser target is the current evergreen desktop, tablet, and mobile browsers with Pointer Events and Web Storage support.

An empty journal starts with sample activities so you can explore the timeline. Clear them from the banner on the timeline or in Settings → Data; your own activities stay in place.

## PWA and offline behavior

The production build emits an installable WorkFlow Journal PWA in `out/`. It includes a web manifest, app icons, and a service worker that caches the app shell and previously visited routes. Activity changes continue to save in this browser while offline.

The optional activity API remains best-effort. If it is unavailable, local activity data is still saved and the app shows that remote sync is unavailable. It does not queue background sync or merge remote conflicts.

Deploy the `out/` directory over HTTPS. The host must serve `/sw.js` as JavaScript, avoid long-lived caching for that file, and route the four application paths (`/`, `/search`, `/statistics`, and `/settings`) to their exported HTML files. Run `npm run test:e2e:pwa` to validate the built export locally.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

To start both the frontend and the data service in one terminal, on ports 3001 and 7002:

```bash
npm run dev:all
```

Press `Ctrl+C` to stop both services.

Open [http://localhost:3000](http://localhost:3000) when using `npm run dev`, or [http://localhost:3001](http://localhost:3001) when using `npm run dev:all`.

`dev:all` uses ports 3001 and 7002 by default and keeps its Next.js development files separate from `npm run dev`. Set `WORKFLOW_APP_PORT` or `WORKFLOW_DATA_PORT` before the command to choose different ports. The script points the frontend at the matching data service automatically. The data service does not auto-restart when its code changes in this combined mode; restart `dev:all` after editing it.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
