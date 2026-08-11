# Yad2 Apartment Finder — Tel Aviv & surroundings

Auto-updating apartment tracker for a fixed search, viewable from your phone.

**Search:** `region=3` (תל אביב והסביבה) · 4 rooms · ≤ ₪8,000 · must have **ממ״ד + חניה + מעלית**.

## How it works
- `scrape.js` drives a real **headless Google Chrome** (via Playwright) to clear Yad2's
  Radware bot protection: it warms up on the homepage, then calls Yad2's internal feed API
  and collects all matching listings.
- Results are deduped into `docs/listings.json`, preserving each listing's `firstSeen`
  timestamp and flagging genuinely **new** ones.
- `docs/index.html` is a phone-friendly page (served by **GitHub Pages**) that reads that JSON,
  auto-refreshes, badges new listings, and links each card to Yad2.
- A **launchd** job runs `run.sh` hourly: scrape → commit → push → Pages updates.

If a run is blocked/fails, the previous `listings.json` is kept (no wipe), and the page shows a
stale-update warning.

## Live page
https://solal10.github.io/yad2-finder/

## Manual run
```bash
./run.sh          # scrape + commit + push
node scrape.js    # scrape only
```

## Requirements
- Google Chrome installed (`channel: 'chrome'`)
- Node 18+, `npm install`
- Runs on macOS while the machine is awake.
