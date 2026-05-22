# Fake Internet — Architecture Specification

> **Document status:** Source of truth.
> **Scope:** The BuckyNet content universe — the search engine, video platform, wiki, social network, corporate sites, hacker forums, news sites — and the content model, search index, and naming registry behind them.
> **Depends on:** `networking-system.md` (transport), `database-system.md` (content storage).
> **Consumed by:** `browser-system.md`, `osint-system.md`, `mission-progression.md`, `mail-system.md`.

---

## 1. Purpose

The fake internet is the *content* of BuckyNet — the websites a player visits, the articles they read, the videos they watch, the profiles they investigate. Where `networking-system.md` specifies the transport (how an address becomes a response), this document specifies the **content universe**: what sites exist, how their pages are modelled, how they link to each other, and how they carry the hints and clues that drive missions and OSINT.

The fake internet exists to:

1. **Make BuckyNet feel like a real internet.** A search engine, a video site, an encyclopedia, a social network, corporate sites, forums, news — the recognizable shape of the web, entirely fictional and Bucky-themed.
2. **Carry the game.** Pages are not decoration. They hold clues, traces, hidden references, and lore. The fake internet is the largest single surface for missions and OSINT investigation.
3. **Stay strictly fictional.** No real brand, company, person, or domain appears anywhere. Every service is a Bucky-universe invention with its own name (§3).
4. **Scale to hundreds of pages.** Content is data, authored against a uniform page model and lazy-loaded — never hand-built markup.

This document is also the **canonical naming registry** (§3): every fictional brand name used anywhere in the VM is defined here so all other systems stay consistent.

---

## 2. Architecture Overview

### 2.1 Content providers

Each class of site is served by a **content provider** registered with `NetworkService` (`networking-system.md` §5.3). A provider receives `(path, query, fragment)` for its host(s) and returns a structured Response payload. Providers:

| Provider | Serves | Host(s) |
|----------|--------|---------|
| `sift-provider` | Search engine | `sift` |
| `loop-provider` | Video platform | `loop` |
| `warren-provider` | Wiki / encyclopedia | `warren` |
| `hutch-provider` | Social network | `hutch` |
| `hollow-provider` | Hacker forums | `hollow` |
| `ledger-provider` | News | `ledger` |
| `corporate-provider` | All corporate sites | `helix-dynamics`, `northgate-freight`, … |

The provider holds rendering/route logic; the *content itself* is a dataset owned by `DatabaseService` under the **browser content database** (`database-system.md`). Provider = behavior; dataset = data.

### 2.2 The page model

Every page on BuckyNet — a wiki article, a video, a profile, a forum thread, a corporate landing page — is an instance of one **page model** with a type-specific `body`. Uniformity is what lets the browser render anything and lets missions/OSINT scan everything with one set of rules.

### 2.3 Layered structure

```
Fake Internet
  ├─ Naming registry        canonical fictional brand names (§3)
  ├─ Page model             uniform envelope + typed body (§4)
  ├─ Content datasets       authored pages, per site, in the content DB
  ├─ Search index           inverted index over indexable pages (§5)
  ├─ Relationship graph     hyperlinks, citations, embeds, mentions (§6)
  └─ Hint layer             embedded clues/traces consumed by missions/OSINT (§7)
```

---

## 3. Canonical Naming Registry

Every fictional service in the Bucky VM is named here. **No real brand names anywhere.** Other documents reference these names; this table is the source of truth.

| Real-world analogue | BuckyNet name | Host | Notes |
|---------------------|---------------|------|-------|
| Search engine | **Sift** | `sift` | "Sift through BuckyNet." |
| Video platform | **Loop** | `loop` | Videos, comments, likes. |
| Encyclopedia / wiki | **Warren** | `warren` | The community knowledge base. |
| Social network | **Hutch** | `hutch` | Profiles, posts, followers. |
| Hacker forum | **Hollow** | `hollow` | Underground community; gated. |
| News site | **The Ledger** | `ledger` | BuckyNet news and incident reporting. |
| The network itself | **BuckyNet** | — | The fictional internet (`networking-system.md`). |
| The player's employer / SOC | **Bucky Security** | `bucky-security` | The in-universe cybersecurity org; issues the VM. |
| Mail domain | **bucky,net** | `bucky` (mail host) | Comma form `name@bucky,net` (`mail-system.md`). |
| Package manager | **bpkg** | — | Terminal package manager (`terminal-system.md`). |

**Example fictional corporations** (extend freely; all invented): *Helix Dynamics*, *Northgate Freight*, *Meridian Data Group*, *Caldera Energy*, *Tinbark Logistics*. **Example threat actors / malware** (lore): the *GnawWorm* malware family, the *Static Den* crew, *Operation Hollowpoint*. These are illustrative; missions define their own as needed, always fictional, always Bucky-themed.

---

## 4. The Page Model

### 4.1 Common envelope (all pages)

| Field | Meaning |
|-------|---------|
| `address` | Canonical `bnet://` address. |
| `host` | Owning host. |
| `type` | `search-results`, `video`, `article`, `profile`, `thread`, `feed`, `corporate`, `news`. |
| `title` | Page title. |
| `summary` | Short description (used by search snippets). |
| `publishedAt` | In-universe publish date. |
| `author` | The fictional account/entity that produced it. |
| `indexable` | Whether the page appears in Sift's index. |
| `links` | Outbound BuckyNet addresses referenced by the page. |
| `tags` | `lore`, `clue`, `mission:<id>`, `corp`, `incident` — used by missions/OSINT. |
| `hints` | Embedded hint descriptors (§7). |
| `gating` | Optional level/mission gate. |
| `body` | The type-specific content (§4.2). |

### 4.2 Typed bodies

- **article** — sections, an infobox, citations (links to other Warren articles or sources).
- **video** — a video descriptor (title, "thumbnail", duration, channel), `description` text, `comments[]`, `likes`.
- **profile** — handle, display name, bio, avatar, `followers`/`following` counts, `posts[]`, metadata block.
- **thread** — forum original post + `replies[]`, board, author handles.
- **feed** — a stream of social posts (a Hutch home/search feed).
- **corporate** — landing sections, "about", staff/contact blocks, optional internal/firewalled subpaths.
- **news** — headline, byline, body, related-incident links.
- **search-results** — the ranked result list (produced by the search provider, §5).

### 4.3 Comments, likes, posts

Comments, replies, posts, and likes are sub-models attached to bodies. A **comment/post** has: `id`, `author` (handle), `text`, `postedAt`, `likes`, optional `links`, optional `hints`. This means *clues can live in a comment*, not just in page bodies — central to the design (§7).

---

## 5. Search Engine — Sift

### 5.1 Role

**Sift** (`bnet://sift`) is BuckyNet's search engine and the player's main entry point into the fake internet. It is how a player turns a name, a handle, a domain, or a keyword from a mail or a leak into pages to investigate.

### 5.2 Search index

The search index is an **inverted index**: term → list of `{ address, weight }`. It is built at content-load time over every page with `indexable: true`, drawing terms from `title`, `summary`, `tags`, body text, and — importantly — author handles and comment text. The index is owned by the `sift-provider` and stored in the content database.

### 5.3 Query and ranking

A query (`bnet://sift/results?q=<terms>`) is tokenized, looked up per term, and the candidate pages are ranked by: term weight, field weight (title > summary > body > comments), `tags` boosts, and recency. The result Response is a `search-results` page: a ranked list of `{ address, title, snippet, host }`. Snippets are extracted around matched terms.

### 5.4 Indexing controls for gameplay

- **`indexable: false`** hides a page from search — it exists but must be found by following a link, deduced, or unlocked. Hidden pages are a core OSINT mechanic.
- **Gated index entries** — some results only appear once a mission/level unlocks them.
- **Seeded results** — missions can ensure a specific page surfaces for a specific query so a clue chain is followable.

---

## 6. Content Relationships

The fake internet is a *graph*, not a list. Pages connect through:

- **Hyperlinks** — `links` in the envelope; the browser renders them as clickable BuckyNet links.
- **Citations** — Warren articles cite sources (other articles, news, corporate pages).
- **Mentions** — a Hutch post or Hollow reply mentioning a handle links to that profile.
- **Embeds** — a page embedding a Loop video or a quoted post.
- **Cross-host references** — a news article about an incident linking the corporate site, the malware's wiki article, and the relevant forum thread.

This relationship graph is what makes investigation possible: a player pulls one thread (a handle in a leak) and follows links across Sift → Hutch → Hollow → Warren → Ledger. The graph is also a data source for `osint-system.md`, which treats pages, handles, and hosts as entities and these relationships as edges.

---

## 7. The Hint Layer (Clues and Traces)

### 7.1 Concept

A **hint** is an authored piece of content that means something to a mission or OSINT investigation. Hints turn passive content into gameplay. A hint descriptor (in a page's or comment's `hints`):

| Field | Meaning |
|-------|---------|
| `id` | Hint id. |
| `mission` | The mission/clue chain it belongs to. |
| `kind` | `clue`, `trace`, `credential`, `bankcode`, `reference`, `lore`. |
| `value` | The payload — a string, an address, a handle, a code. |
| `discovery` | How it is found: `visible`, `in-comment`, `in-description`, `in-source`, `requires-tool`. |
| `reveals` | What discovering it unlocks (a next address, a host, a mission step). |

### 7.2 Where hints hide

- **In page bodies** — a sentence in a Warren article, a line in a news report.
- **In video descriptions** — a Loop description containing a handle or address.
- **In comments** — a throwaway Loop comment or Hollow reply holding the real clue.
- **In profile metadata** — a Hutch bio, a join date, a linked address.
- **In page source** — a `requires-tool`/`in-source` hint visible only via the browser's "view source" or a tool, teaching the idea that pages hide data.
- **As bankcodes** — a hint of kind `bankcode` carries an economy code (`mission-progression.md`, `discord-integration.md`).

### 7.3 Discovery and missions

The mission system subscribes to `net:navigated` and to browser interactions; when the player reaches a page or expands a comment carrying a hint, the relevant clue is marked discovered (`mission:clue-found`). Hints are the connective tissue between the fake internet and `mission-progression.md` and `osint-system.md`.

---

## 8. Video Platform — Loop

**Loop** (`bnet://loop`) is BuckyNet's video platform — the YouTube analogue.

### 8.1 Content

A Loop video page (`type: video`) carries: a video descriptor (title, channel/author, duration, "thumbnail" asset), a **description** (free text, a prime hint location), a **comment thread**, and a **like** count. Videos belong to channels (a channel is a kind of profile/host).

### 8.2 Video categories

- **Lore videos** — Bucky-universe storytelling; background and worldbuilding.
- **Dev videos** — in-universe "developer" content used for tone, tutorials, and meta hints.
- **Mission-clue videos** — videos authored as mission steps; the description or a pinned comment carries the clue.
- **Ambient videos** — filler that makes Loop feel populated.

### 8.3 Clues on Loop

Loop is a hint-rich site. Clues hide **in descriptions** (`in-description`) and **in comments** (`in-comment`) — a hidden handle, a `bnet://` address, a code dropped by a fictional commenter. The comment thread is a first-class clue surface (§4.3): a mission can require the player to scroll a comment thread and notice a specific reply. Likes and comment counts are flavor and can be tuned so a "suspicious" video stands out.

---

## 9. Wiki — Warren

**Warren** (`bnet://warren`) is BuckyNet's encyclopedia — the Wikipedia analogue and the player's reference for the Bucky universe.

### 9.1 Article subjects

Warren articles cover, at minimum: **items** and collectibles; **enemies** and threat actors; **lore** and world history; **commands and tools** (in-universe documentation for terminal commands and installable tools — the "man pages" of `terminal-system.md`); **organizations and corporations**; **malware** families and their behavior; **incidents** and historical breaches; and **mission/progression lore**.

### 9.2 Article model

A Warren article (`type: article`) has: sections, an **infobox** (structured key/value facts — for a malware article: family, first-seen, targets, related incidents), and **citations** linking to other Warren articles, Ledger news, or corporate pages. Articles are heavily interlinked (§6), so reading one pulls the player deeper.

### 9.3 Warren as a learning and mission surface

Warren is where the project's **educational** goal lives most explicitly: a malware article can accurately explain a class of attack in-universe; a tool article teaches what `netmapper` does. Articles carry `lore` and `clue` hints; an `incident` article may contain the exact detail a mission needs. Some articles are `indexable: false` or gated, so part of Warren is itself a discovery (§5.4).

---

## 10. Social Network — Hutch

**Hutch** (`bnet://hutch`) is BuckyNet's social network. Its architecture and its OSINT role are specified jointly here and in `osint-system.md`; this section covers the content model.

### 10.1 Content

A Hutch **profile** (`type: profile`) has: a handle, display name, avatar, bio, join date, follower/following counts and lists, a metadata block, and a stream of **posts**. A **post** has author, text, timestamp, likes, replies (comments), and optional links/media. A **feed** aggregates posts (home, search, hashtag).

### 10.2 OSINT relevance

Hutch is the primary OSINT playground. Profiles carry **searchable traces** — a handle reused across sites, a join date that correlates with an incident, a location hint in a bio, a follower link to a suspect, a leaked-screenshot post. Investigation mechanics (correlating a leak record's name to a Hutch handle, walking follower chains, spotting a deleted-but-cached post) are detailed in `osint-system.md`; the content model here provides the fields those mechanics read.

---

## 11. Hacker Forums — Hollow, News — The Ledger, Corporate Sites

### 11.1 Hollow (forums)

**Hollow** (`bnet://hollow`) is the underground forum: boards, threads, replies, pseudonymous handles. It is largely **gated** — reachable only after a mission/level unlock — so entering Hollow is itself progression. Hollow is where leak announcements, tool chatter, and the darker clue chains live.

### 11.2 The Ledger (news)

**The Ledger** (`bnet://ledger`) is BuckyNet news: incident reporting, corporate coverage, security stories. The Ledger is the *event surface* of the fake internet — when a leak event fires (`database-system.md`), a Ledger article can be generated to report it, linking the corporate site, the malware's Warren article, and the Hollow thread. It is the connective news layer of an investigation.

### 11.3 Corporate sites

Corporate sites (`bnet://helix-dynamics`, etc.) are the targets of investigations and missions: public landing pages plus optional **internal/firewalled subpaths** (`forbidden` until a mission opens them — `networking-system.md` §7.3). Corporate sites carry `owner` data, staff handles (cross-linking to Hutch), and the breach surface a mission revolves around.

---

## 12. Subsystem Responsibilities

| Component | Responsibility |
|-----------|----------------|
| Content providers | Route a host's paths to page payloads. |
| Page model | Uniform envelope + typed bodies for all content. |
| Content datasets | Authored pages stored in the browser content DB. |
| Search index (Sift) | Inverted index, query, ranking, snippets. |
| Relationship graph | Links, citations, mentions, embeds between pages. |
| Hint layer | Embedded clues/traces feeding missions and OSINT. |
| Naming registry | Canonical fictional brand names. |

---

## 13. Dependencies

- **Networking system** (`networking-system.md`) — providers are registered with NetworkService; hosts come from the host registry.
- **Database system** (`database-system.md`) — page content and the search index are datasets in the browser content DB; leak events generate news content.
- **Browser system** (`browser-system.md`) — renders the page model.
- **Mission & OSINT** (`mission-progression.md`, `osint-system.md`) — consume hints, relationships, and traces.
- **Mail system** (`mail-system.md`) — mails link to BuckyNet pages.

---

## 14. Extension Points

- **New site** — add a host record + a content provider (or reuse one) + a content dataset.
- **New page type** — add a typed body and the browser renderer for it.
- **New hint kind** — extend the hint `kind` set and the mission/OSINT handlers.
- **Content packs** — ship batches of pages as datasets loaded on demand (per mission arc).
- **Authoring pipeline** — a structured content format/tooling so non-engineers can author pages.
- **Dynamic/generated content** — providers that synthesize pages from datasets (a profile page generated from a leak record).
- **Localization** of content text, separate from the page model.

---

## 15. Scalability Concerns

| Concern | Mitigation |
|---------|------------|
| Hundreds of pages | Pages are dataset records against one model; loaded lazily per host/arc, never hand-built markup. |
| Search index size | Index built per loaded content pack; sharded by host; only `indexable` pages included. |
| Relationship graph growth | Links are addresses (strings); the graph is derived, not duplicated. |
| Authoring burden | One page model + a content format keeps authoring uniform and tool-assistable. |
| Clue/hint sprawl | Hints are descriptors keyed to missions; the mission system owns their lifecycle. |
| Keeping content fictional | The naming registry (§3) is the single source; reviews check new content against it. |
| Determinism | Content is authored data; search ranking is deterministic, so clue chains are reliably solvable. |

---

## 16. Future Systems

- **Generated profiles/pages** from leak and database records.
- **Event-driven content** — Ledger articles and Hollow threads spawned by leak events.
- **A content authoring tool** for fast page creation.
- **Account/session state** on Hutch and corporate sites (fake logins unlocking private pages).
- **Media simulation** — richer "video" and "image" placeholders.
- **Content versioning** — edited/deleted-but-cached pages as an OSINT mechanic.
- **Per-arc content packs** sized to mission releases.

---

## 17. Recommended Implementation Order

1. **Lock the naming registry** (§3) — every later asset uses it.
2. **Define the page model** — envelope + typed bodies.
3. **Build the wiki provider (Warren)** — the simplest rich content type (articles) and the reference backbone.
4. **Build the search engine (Sift)** — the index, query, ranking, and `search-results` pages; the player's entry point.
5. **Add the video platform (Loop)** and the social network (Hutch) — comment/post/like sub-models.
6. **Add the relationship graph** wiring (links, citations, mentions, embeds).
7. **Add the hint layer** — embed clues in bodies, descriptions, comments; wire `mission:clue-found`.
8. **Add The Ledger and corporate sites**, including firewalled subpaths.
9. **Add Hollow** with gating tied to progression.
10. **Add generated/event-driven content and the authoring pipeline** as content volume grows.

Steps 1–4 give a searchable, browsable fake internet; steps 5–7 make it interactive and clue-bearing; steps 8–10 complete the universe and scale authoring.
