# Browser System — Architecture Specification

> **Document status:** Source of truth.
> **Scope:** The Browser app — the client that navigates and renders BuckyNet: URL bar, history, tabs, page rendering, link handling, embedded-hint discovery.
> **Depends on:** `networking-system.md` (transport), `fake-internet.md` (content), `app-system.md`, `render-system.md`.
> **Consumed by:** the player; `mission-progression.md` and `osint-system.md` (navigation events, discovery).

---

## 1. Purpose

The Browser is the app through which the player experiences the fake internet. It is the in-universe web browser of the Bucky VM: a window with a URL bar, navigation controls, history, tabs, and a viewport that renders BuckyNet pages.

The Browser exists to:

1. **Make BuckyNet navigable.** Type an address, click a link, run a search, go back — the familiar browsing loop, over the simulated `bnet://` network.
2. **Render the page model.** Turn the structured page payloads of `fake-internet.md` into interactive DOM — articles, videos, profiles, threads, feeds, corporate pages, search results.
3. **Be an investigation instrument.** Browsing *is* OSINT gameplay. The Browser must support discovering embedded hints: scrolling comments, reading descriptions, inspecting page source, following links across hosts.
4. **Stay a thin client.** The Browser resolves nothing itself. It sends an address to `NetworkService`, receives a Response, and renders it. All content and routing live behind the network layer.

The Browser is one app; the *sites* it visits (Sift, Loop, Warren, Hutch, Hollow, The Ledger, corporate) are content, not separate apps (`app-system.md` §9).

---

## 2. Architecture Overview

### 2.1 Position

```
Browser app (apps/BrowserApp.js)  — single-instance, live app
  ├─ Chrome        URL bar, back/forward/reload/home, tab strip
  ├─ Navigation    request lifecycle, history, tab state
  ├─ Viewport      renders the current Response payload
  └─ Page Renderers  one per page type (article, video, profile, thread, feed, corporate, search-results, error)
        │  request(bnet://…)
        ▼
NetworkService (runtime.services.net)  → Response  (networking-system.md)
```

The Browser holds *navigation state*; `NetworkService` holds the network; `fake-internet.md` providers hold the content. The Browser never parses an address or fetches content directly — it calls `net.request(address)`.

### 2.2 Live app

The Browser is a *live* app (`render-system.md` §6.3). The viewport changes wholesale on navigation but the chrome (URL bar, tabs) must keep transient state — caret in the URL bar, tab focus. The Browser uses delegated sub-regions: a `chrome` sub-region (patch-only), a `tab-strip` sub-region (keyed list), and a `viewport` sub-region (replaced per navigation, internally reconciled for incremental content like loading more comments).

---

## 3. Browser State Model

### 3.1 Browser `appState`

| Field | Meaning |
|-------|---------|
| `tabs[]` | Open browser tabs (§4). |
| `activeTab` | Index of the focused tab. |
| `homeAddress` | The address the Home button loads (`bnet://sift`). |

### 3.2 Tab model

Each tab is an independent browsing context:

| Field | Meaning |
|-------|---------|
| `id` | Tab id. |
| `address` | Current `bnet://` address. |
| `title` | Current page title (for the tab label). |
| `history[]` | Ordered list of visited addresses. |
| `historyIndex` | Pointer into `history` (back/forward). |
| `status` | `idle`, `loading`, `loaded`, `error`. |
| `response` | The last Response from NetworkService. |
| `scroll` | Saved scroll offset (restored on back/forward). |
| `viewState` | Per-page UI state — expanded comment threads, "view source" open, feed page. |

History is **per tab**. Back/forward move `historyIndex`; a fresh navigation truncates forward history and appends — standard browser semantics.

---

## 4. Tabs

The Browser supports multiple tabs so a player can hold several investigation threads at once — a leak record open in one tab, a Hutch profile in another, a Warren article in a third. The tab strip is a keyed render region (`render-system.md`): opening, closing, and switching tabs touches only the strip and swaps the viewport; other tabs' DOM and scroll state are preserved on their tab objects and restored on switch.

A single-tab v1 is acceptable as a first milestone; the state model above is already tab-shaped so adding tabs later is additive.

---

## 5. Navigation

### 5.1 Navigation lifecycle

```
navigate(address)  (from URL bar, link click, search result, or intent)
  → validate/normalize the address string
  → tab.status = "loading"; viewport shows a loading state (uses Response.latency)
  → net.request(address)
  → on Response:
       ok    → tab.response set, history appended, status "loaded", emit net:navigated
       error → status "error", render the error page (host-not-found / forbidden / bad-address)
  → render the viewport via the page renderer for response.contentType
```

### 5.2 Navigation sources

- **URL bar** — the player types a `bnet://` address (or a bare host; the Browser normalizes `warren` → `bnet://warren`).
- **Link clicks** — every rendered hyperlink carries its target address; clicking navigates.
- **Search results** — a Sift result row navigates to its `address`.
- **History** — back/forward via `historyIndex`.
- **Home** — loads `homeAddress`.
- **Intents** — another app opens the Browser at an address via an `open-url` intent (`app-system.md` §8.3) — e.g. Mail opening a link, the terminal's `open`, OSINT pivoting to a profile.

### 5.3 History

Per-tab history supports back, forward, and reload. Reload re-requests the current address (re-running latency and the request pipeline). Scroll offset is saved on navigate-away and restored on back/forward so investigation context is not lost.

### 5.4 Address bar behavior

The URL bar shows the current `address` and accepts input. It normalizes bare hostnames, rejects non-`bnet://` input with a gentle inline error, and (future) offers autocomplete from history and the host registry. It never accepts `http://` — there is no real web to reach.

---

## 6. Page Rendering

### 6.1 Renderer registry

The Browser holds a **page-renderer registry**: `contentType → renderer`. A renderer takes a Response payload and returns viewport DOM. Renderers:

| contentType | Renders |
|-------------|---------|
| `search-results` | Sift ranked result list with snippets. |
| `article` | Warren article: sections, infobox, citations. |
| `video` | Loop video page: video panel, description, comments, likes. |
| `profile` | Hutch profile: header, bio, metadata, post stream, follower links. |
| `thread` | Hollow forum thread: original post + replies. |
| `feed` | Hutch feed: a stream of posts. |
| `corporate` | Corporate landing page: sections, about/contact, subpaths. |
| `news` | Ledger article. |
| `error` | host-not-found / forbidden / bad-address pages. |

Adding a new page type = registering a renderer. The Browser core (chrome, navigation, history) never changes.

### 6.2 Rendering the page model

Renderers consume the uniform page model (`fake-internet.md` §4): the envelope (title, links, tags, hints) plus the typed body. Common cross-cutting rendering — making `links` clickable, surfacing comment threads, exposing "view source" — is shared renderer infrastructure so every page type behaves consistently.

### 6.3 Links and interactivity

Every hyperlink the renderer emits carries a `data-bnet-address`. A delegated viewport listener turns any link click into a `navigate(address)` call. Comments and posts are expandable; videos have a (simulated) play affordance; feeds and long comment threads load incrementally. All of this interaction is captured by the Browser, not by the content provider.

### 6.4 View source

The Browser exposes a **view-source** affordance per page. It reveals the raw page payload, including content marked `discovery: in-source` (`fake-internet.md` §7.2). This is a deliberate gameplay and *educational* mechanic — it teaches that pages carry data beyond what is visually rendered, and it is where certain hints are hidden.

---

## 7. Embedded Hints and Discovery

### 7.1 The Browser as a discovery surface

Hints live in BuckyNet content (`fake-internet.md` §7). The Browser is *where they are discovered*. Discovery is driven by player interaction, and the Browser is responsible for detecting and reporting it:

| Hint discovery | Browser behavior |
|----------------|------------------|
| `visible` | Discovered on page load (page reached). |
| `in-description` | Discovered when the player reads/expands a video description. |
| `in-comment` | Discovered when the player expands the comment/reply containing it. |
| `in-source` | Discovered when the player opens view-source. |
| `requires-tool` | Discovered only when a terminal tool has processed the page. |

### 7.2 Discovery events

On every navigation and significant interaction (comment expanded, source viewed) the Browser emits events the mission and OSINT systems consume:

- `net:navigated` — a page was loaded (emitted via the network pipeline).
- `browser:hint-revealed` — a hint became visible to the player through interaction.
- `browser:link-followed` — a specific link was clicked (for tracking clue-chain traversal).

The mission system (`mission-progression.md`) and OSINT system (`osint-system.md`) subscribe; the Browser itself contains no mission logic. It reports interaction; the game systems interpret it.

### 7.3 Saving from the browser

The Browser can save content to the filesystem (`filesystem.md` §5.4): a "save page" / "download" action writes a file under `/downloads/`, tagged with the source address. This turns browser findings into filesystem artifacts other apps and tools can use — e.g. saving a leaked screenshot for an OSINT case.

---

## 8. Important Flows

### 8.1 Flow — search then read

```
URL bar: "bnet://sift" → Sift home renders
type query, submit → navigate("bnet://sift/results?q=gnawworm")
  → net.request → search-results Response → results renderer
click a result → navigate(result.address) → article renderer (Warren)
back → historyIndex--, previous results page restored with scroll
```

### 8.2 Flow — discovering a clue in a comment

```
navigate("bnet://loop/watch/v-4471") → video renderer; description + comments shown
player expands a reply carrying a hint { kind:"bankcode", discovery:"in-comment" }
  → Browser detects the hint in the expanded comment
  → emit browser:hint-revealed
  → MissionService marks the clue found → mission:clue-found → notification
```

### 8.3 Flow — Mail hands off a link

```
Mail message contains a bnet:// link
player clicks it → Mail issues openApp("browser", { intent:"open-url", address })
  → Browser opens (or focuses), opens a tab at the address, navigates
```

### 8.4 Flow — a firewalled corporate page

```
navigate("bnet://helix-dynamics/internal")
  → net.request → Response status "forbidden"
  → error renderer shows an access-denied page
  → later, a mission unlock clears the host gating; the same navigation now loads
```

### 8.5 Flow — view source reveals a hidden trace

```
on any page → player opens view-source
  → Browser renders the raw payload, including in-source hints
  → emit browser:hint-revealed for any in-source hint on the page
```

---

## 9. Subsystem Responsibilities

| Component | Responsibility |
|-----------|----------------|
| Browser chrome | URL bar, navigation controls, tab strip. |
| Navigation | Request lifecycle, per-tab history, intents. |
| Viewport | Hosts the active page renderer. |
| Page-renderer registry | One renderer per content type; renders the page model. |
| Renderer infrastructure | Shared link handling, comment expansion, view-source. |
| Discovery layer | Detects hint reveals; emits `browser:*` events. |
| NetworkService | Address resolution, routing, Responses (`networking-system.md`). |
| Content providers | Page content (`fake-internet.md`). |

---

## 10. Dependencies

- **NetworkService** (`networking-system.md`) — the Browser's sole means of loading anything.
- **Fake internet** (`fake-internet.md`) — the page model the renderers consume.
- **App system** (`app-system.md`) — the Browser is a registered app; `open-url` intents.
- **Render system** (`render-system.md`) — live-app sub-regions for chrome/tabs/viewport.
- **Filesystem** (`filesystem.md`) — "save page" writes to `/downloads/`.
- **Mission & OSINT** — consumers of `net:navigated` and `browser:*` events.

The Browser depends on the network and content layers; nothing depends on the Browser's internals.

---

## 11. Extension Points

- **New page renderer** — register a renderer for a new content type.
- **Bookmarks** — saved addresses, persisted with the account.
- **Autocomplete** — URL-bar suggestions from history and the host registry.
- **Find in page** — text search within the rendered viewport.
- **Reader/inspect tools** — deeper view-source, a metadata inspector, a link map.
- **Tab groups / session restore** — restoring open tabs after a refresh via PersistenceService.
- **In-page app embeds** — embedding interactive widgets (a login form on a corporate site) as renderer sub-components.
- **Browser extensions flavor** — installable browser tools mirroring the package model.

---

## 12. Scalability Concerns

| Concern | Mitigation |
|---------|------------|
| Re-rendering on every navigation | Only the viewport sub-region swaps; chrome/tabs persist (`render-system.md`). |
| Long pages (big threads, long feeds) | Renderers paginate/virtualize comment lists and feeds; incremental "load more". |
| Many open tabs | Tab strip is a keyed region; inactive tabs keep state on their tab object, not in the DOM. |
| Heavy content datasets | Content is lazy-loaded by providers; the Browser holds only the current Response per tab. |
| History growth | Per-tab history is a list of address strings — cheap; capped if needed. |
| Discovery-event volume | `browser:*` events fire on discrete interactions, not continuously; coalesced by the scheduler. |
| Renderer sprawl | One renderer per content type, registry-driven; the Browser core is fixed. |

---

## 13. Future Systems

- **Bookmarks and session restore** synced via PersistenceService.
- **URL-bar autocomplete and find-in-page.**
- **A metadata/inspector panel** deepening the view-source mechanic for advanced OSINT.
- **In-page interactive embeds** — fake login forms, search widgets, comment posting.
- **Browser tools/extensions** installable via the package model.
- **A link-map / site-graph view** visualizing how the current investigation's pages connect.
- **Reading history as an OSINT artifact** the player can review.

---

## 14. Recommended Implementation Order

1. **Build the Browser app shell** — single tab, URL bar, navigation controls, viewport.
2. **Wire navigation to NetworkService** — request lifecycle, loading/error states.
3. **Per-tab history** — back/forward/reload, scroll save/restore.
4. **Build the page-renderer registry** and the first renderers — `search-results`, `article`, `error`.
5. **Add the remaining renderers** — `video`, `profile`, `thread`, `feed`, `corporate`, `news`.
6. **Add link handling and shared renderer infrastructure** (clickable links, comment expansion).
7. **Add view-source and the discovery layer** — emit `browser:hint-revealed` / `browser:link-followed`.
8. **Add multiple tabs** and `open-url` intents from Mail/Terminal/OSINT.
9. **Add "save page"** to the filesystem.
10. **Add bookmarks, autocomplete, find-in-page, and session restore** as the content universe grows.

Steps 1–5 deliver a working browser over the fake internet; steps 6–9 make it the investigation instrument missions and OSINT depend on.
