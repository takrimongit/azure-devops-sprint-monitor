# Sprint Health — Mobile

A Helpables-branded **React Native (Expo)** companion app for the
[azure-devops-sprint-monitor](https://github.com/takrimongit/azure-devops-sprint-monitor)
backend. It takes the same sprint-hygiene logic that runs as a nightly
email report and puts it in your pocket — a live A–F health grade, the
findings behind it, and the sprint taskboard, on iOS, Android, and web.

> Built as a Helpables self-proof showcase: the agency runs its own delivery
> hygiene on the same automation it sells.

## What it does

The backend CLI fetches Azure DevOps work items, runs ~12 hygiene rules,
grades the sprint A–F, and emails an HTML report. This app reuses that
**exact rule logic** ([`src/engine.ts`](src/engine.ts) is a faithful port of
the backend's `evaluateHygiene` / `analyzeSprint`) and renders it as three
screens:

| Screen | Shows |
|---|---|
| **Health** | A–F grade dial, summary cards (total/active/new/closed), sprint metrics (completion %, new ratio, aging), and per-person team load bars |
| **Findings** | Every CRITICAL / WARNING finding with the rule that fired, filterable by severity |
| **Board** | Lane counts (To do / In Progress / In Review / Completed) and the taskboard grouped by parent story |

## Architecture

```
backend (azure-devops-sprint-monitor)        this app (sprint-monitor-mobile)
┌─────────────────────────────┐              ┌──────────────────────────────┐
│ Azure DevOps API            │              │ Expo / React Native (TS)     │
│  → fetchSprintData()        │              │  App.tsx  (tabs + brand bar) │
│  → evaluateHygiene()  ──────┼──ported──────┼─→ src/engine.ts              │
│  → OpenRouter (AI report)   │              │  src/rulesConfig.ts          │
│  → nodemailer (email)       │              │  src/screens/*  components/*  │
└─────────────────────────────┘              └──────────────────────────────┘
```

The hygiene engine is **pure TypeScript with no native or network
dependencies**, so it runs fully on-device. The app ships with realistic
sample data ([`src/sampleData.ts`](src/sampleData.ts), modelled on the
`aidapp` project) so it runs with zero configuration — no PAT, no secrets.

## Run it

```bash
cd sprint-monitor-mobile
npm install
npm start          # then press i (iOS), a (Android), or w (web)
```

- iOS Simulator: `npm run ios`
- Android emulator: `npm run android`
- Browser: `npm run web`

Type-check: `npx tsc --noEmit`

## Going from demo to live data

The app is wired so only the data source needs to change. Two options:

1. **Backend endpoint (recommended).** Add a small HTTP route to the
   backend that returns the `Sprint` JSON (tasks + dates), then replace the
   `sampleSprint` import in [`App.tsx`](App.tsx) with a `fetch()` into the
   same `evaluateSprint()` call. Keeps the PAT and OpenRouter key server-side
   — never ship those in a mobile bundle.
2. **Direct Azure DevOps (internal builds only).** Port `fetchSprintData()`
   to the device using a read-only PAT. Only acceptable for an internal,
   non-distributed build.

The `Task` / `Sprint` shapes in [`src/types.ts`](src/types.ts) match the
backend, so either path drops straight into the existing rule engine.

## Brand

Dark-first Helpables theme — deep teal `#02292E`, navy `#151E2D`, action
green `#3ECF6E`, blue→green logo gradient `#24B3F5`→`#9AED47`. Palette lives
in [`src/theme.ts`](src/theme.ts).
