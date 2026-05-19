# Timeline of Everything

An interactive canvas-based timeline that lets you search and visualize any historical entity from Wikidata — people, events, countries, inventions, diseases, and more.

**100% vibe-coded** with [Claude Code](https://claude.ai/code) (Opus) and [OpenAI Codex](https://chatgpt.com/codex) when Claude's limits ran out. No line was written by a human.

## How it works

1. **Search** — Type anything in the search bar. The app queries the [Wikidata API](https://www.wikidata.org/wiki/Wikidata:Main_Page) for matching entities across multiple languages (English and Russian).

2. **Date extraction** — For each result, the app pulls all available date pairs from Wikidata properties (birth/death, inception/dissolved, first flight, service period, etc.). If Wikidata has no direct dates, it falls back to parsing the entity's Wikipedia article for year references. Entities with multiple date ranges (e.g. an aircraft's first flight *and* service period) show as separate selectable options.

3. **Canvas rendering** — Selected entities appear as colored bars on an infinite, zoomable timeline. Events without an end date render as point markers (vertical line + circle). Scroll to zoom, drag to pan. The timeline supports scales from individual years to billions of years.

4. **Glow animation** — Clicking a search tag highlights the corresponding bar with a smooth glow effect that fades out over 600ms.

## Stack

Zero dependencies. Three files:

- `index.html` — shell
- `style.css` — dark theme styles
- `timeline.js` — everything else (~1200 lines): Wikidata API, Wikipedia fallback parser, canvas renderer, search UI, keyboard navigation

## Running locally

```
python3 -m http.server 8080
```

Open `http://localhost:8080`.
