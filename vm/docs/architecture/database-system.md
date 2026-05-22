# Database System — Architecture Specification

> **Document status:** Source of truth.
> **Scope:** `DatabaseService` — the fictional datasets behind the VM: leaks, users, breaches, mail, missions, browser content, and OSINT; the cache, persistence, and the leak-event engine.
> **Depends on:** `vm-runtime.md` (storage tiers, event bus, persistence).
> **Consumed by:** `mail-system.md`, `osint-system.md`, `mission-progression.md`, `networking-system.md`, `fake-internet.md`, the Database/Leak-Viewer app.

---

## 1. Purpose

The database system is the structured-data backbone of the Bucky VM. Where the filesystem (`filesystem.md`) is the *unstructured* shared layer (files, tool output, notes), the database system is the *structured* layer: tables of records — leaked identities, user profiles, breach events, messages, mission definitions, web content. It is the data the OSINT and mission systems reason over.

The database system exists to:

1. **Hold the game's structured world.** Leak records, fake users, breach events, the browser content corpus, mission definitions — all are datasets owned here.
2. **Enable correlation.** OSINT gameplay is built on *cross-referencing* records: a name in a leak, a handle on social media, an email in a mail, a bankcode in a breach. The database is the substrate that makes correlation possible.
3. **Drive events.** Breaches and leaks are not static. The **leak-event engine** exposes new records over time, reacting to missions and progression, so the data world feels alive.
4. **Respect the storage tiers.** Some data is authored and permanent, some is generated and ephemeral, some must survive a refresh. The database system implements all three tiers (`vm-runtime.md` §6).
5. **Stay strictly fictional.** Every record is invented and Bucky-themed. No real person, company, email, or financial data — ever.

---

## 2. Architecture Overview

### 2.1 DatabaseService

The database system is owned by `DatabaseService`, registered as `runtime.services.db`.

```
DatabaseService (runtime.services.db)
  ├─ Datasets         named collections of records (§4)
  ├─ Query engine     filter / lookup / cross-reference / index access
  ├─ Runtime cache    memoized query results, invalidated on mutation
  ├─ Leak-event engine  schedules/triggers record exposure over time (§7)
  ├─ Tier manager     authored / generated / persistent record handling (§3)
  └─ emits db:* events on the bus
```

### 2.2 Datasets, not a SQL database

"Database" here is conceptual. There is no SQL engine. A **dataset** is a named, in-memory collection of typed records with a query API. This keeps the system vanilla-JavaScript, fast, and serializable, while presenting a database-like mental model to the player (the Leak Viewer app *looks* like a breach-search database).

### 2.3 The Database / Leak-Viewer app

The player-facing surface is the **Database app** (a.k.a. **Leak Viewer**) — a windowed app for searching and reading leak/breach/user records. It is a thin client over `DatabaseService`, exactly as the Mail app is over `MailService`. It is the in-universe tool for "looking someone up."

---

## 3. Storage Tiers in the Database

Every dataset record carries a tier (`vm-runtime.md` §6.2):

| Tier | Records | Behavior |
|------|---------|----------|
| **Authored** | The seed datasets shipped with the build — base users, base web content, base mission definitions, the initial leak corpus. | Loaded at boot; immutable; never serialized (already in the build). |
| **Generated** | Records created at runtime — newly leaked records from events, tool-generated intel, synthesized profiles. | Live in memory; ephemeral; lost on refresh unless promoted. |
| **Persistent** | Records flagged `persistent` — typically a record the player has "discovered"/saved, plus progression-relevant state. | Serialized via `PersistenceService`, keyed to the Discord account, re-hydrated at boot. |

The **tier manager** enforces this: it loads authored datasets, accepts generated records, and promotes/serializes persistent ones. The runtime cache (§6) sits across all tiers.

---

## 4. The Datasets

`DatabaseService` hosts a registry of named datasets. The canonical set:

| Dataset | Holds | Primary consumers |
|---------|-------|-------------------|
| **leaks** | Leaked-identity records (§5) — the core OSINT substrate. | OSINT, missions, Leak Viewer, mail (breach alerts) |
| **users** | Fake user/identity profiles — the "real" people behind handles. | OSINT, social (Hutch), missions |
| **breaches** | Breach/incident events — what was compromised, when, how. | OSINT, missions, news (The Ledger), the leak-event engine |
| **mail** | Message records (the message store for `mail-system.md`). | MailService |
| **missions** | Mission definitions, states, clue chains. | MissionService |
| **content** | The browser content corpus + search index (`fake-internet.md`). | NetworkService content providers, Sift |
| **osint** | The OSINT entity graph — entities and relationships (`osint-system.md`). | OsintService |
| **hosts** | The BuckyNet host registry (`networking-system.md` §4). | NetworkService |

Each dataset has a record schema, a tier mix, and a set of indexes. Datasets are registered, so new ones (a `economy` dataset, a `factions` dataset) are added without touching the service.

---

## 5. The Leak Database

The leak database is the heart of the OSINT game. It is a collection of **leak records** — fragments of compromised identity data the player searches, reads, and cross-references.

### 5.1 Leak record model

| Field | Meaning | Example values |
|-------|---------|----------------|
| `id` | Record id. | `leak-0142` |
| `name` | The person's name (may be partial). | `Tommy` |
| `email` | An email address — comma form (`mail-system.md`). | `tommy@bucky,net` |
| `bankcode` | An economy bankcode — **may be full, partial, or unknown**. | `1X22`, `1234`, `-` |
| `tags` | Free-form labels for filtering and correlation. | `arcade`, `vip`, `flagged` |
| `incidentType` | The kind of incident that exposed this record. | `credential-dump`, `breach`, `phishing`, `insider-leak` |
| `organization` | The compromised organization the leak came from. | `Helix Dynamics`, `Bucky Security` |
| `notes` | Free-text analyst notes / context. | `Linked to arcade-node access` |
| `breachRef` | The breach event this record belongs to (§6). | `breach-04` |
| `tier` | authored / generated / persistent. | — |
| `confidence` | How reliable the record is — supports deliberate noise/red herrings. | `confirmed`, `unverified` |

### 5.2 Partial and missing data is the point

Leak records are deliberately **incomplete**. A `bankcode` may be the full `1234`, a partial `1X22` (some characters unknown/masked), or entirely unknown `-`. A `name` may be just `Tommy`. This is not a data-quality bug — it is the core mechanic: **the player must correlate fragments across sources** to reconstruct a complete picture.

Example: one leak record has `name: Tommy`, `email: tommy@bucky,net`, `bankcode: 1X22`. Another record, or a mail, or a Hutch profile, supplies the missing characters so `1X22` resolves to `1234`. The player assembles the answer; no single record hands it to them. See §8 and `osint-system.md`.

### 5.3 Leak records link outward

A leak record is a hub. Its fields are *references* into the rest of the world:

- `email` ↔ a mail account (`mail-system.md`) and a possible Hutch handle.
- `name` ↔ a `users` record and social profiles.
- `organization` ↔ a corporate host and its BuckyNet site (`fake-internet.md`).
- `breachRef` ↔ a breach event and its Ledger news article.
- `bankcode` ↔ the Discord economy / heist system (`discord-integration.md`).

These links are what the OSINT system walks (§8).

---

## 6. Breaches, Users, and Cross-Dataset Links

### 6.1 Breach records

A **breach record** describes an incident: `id`, `name` (e.g. *Operation Hollowpoint*), `organization` compromised, `incidentType`, in-universe `date`, `method`, affected-record references, and `tags`. Breaches group leak records (`breachRef`) and are the subject of Warren articles and Ledger news. Breaches are also the unit the **leak-event engine** operates on.

### 6.2 User records

A **user record** is a fuller identity than a leak fragment: `id`, `name`, `aliases`/`handles` (Hutch, Hollow, Loop channels), `org`, `bio`, `relationships` (other users), `tier`. Where a leak record is *what leaked*, a user record is *who the person is*. OSINT play is largely about connecting leak fragments to the user record behind them.

### 6.3 The cross-dataset link model

Records reference each other by `{ dataset, id }` pairs. The query engine resolves these. This is what makes correlation a first-class operation: "given this leak record, find the user, the breach, the corporate host, and the social profiles" is a graph traversal the engine supports — and it is exactly what the OSINT entity graph (`osint` dataset) materializes (`osint-system.md`).

---

## 7. The Leak-Event Engine (Event-Driven Leaks)

### 7.1 Concept

The data world is not static. The **leak-event engine** exposes new records — fires "leaks" — over the course of play, so the database grows and reacts.

### 7.2 Triggers

A leak event can be triggered by:

| Trigger | Effect |
|---------|--------|
| Mission progress | Completing a step "unseals" a breach, exposing its leak records. |
| Progression / level | Reaching a level reveals records gated behind it. |
| Time / session | Scheduled drip-feed of records for ambience. |
| Player action | Running a tool (`breachscan`) or finding a clue surfaces related records. |
| Discord / economy event | A heist or economy event on the Discord side triggers a leak via the bridge. |

### 7.3 What a leak event does

When a leak event fires, the engine:

1. Moves the associated records from a sealed/hidden state into the queryable `leaks` dataset (or creates generated records).
2. Emits `db:record-leaked` with the breach/record references.
3. Downstream subscribers react automatically: `MailService` generates a `breach-alerts@bucky,net` message; `fake-internet.md` can spawn a Ledger article and a Hollow thread; `MissionService` may advance a clue chain; the desktop raises a notification.

This single event fanning out to mail, news, missions, and notifications is the canonical example of the event bus earning its place (`vm-runtime.md` §5.4).

---

## 8. Correlation — How Players Connect Information

Correlation is the OSINT gameplay loop. The database system provides the substrate; `osint-system.md` provides the mechanics. The intended player experience:

1. **A lead arrives** — a mail, a clue, a name, a partial bankcode.
2. **The player searches** the Leak Viewer for that fragment (a name, an email, a tag, an organization).
3. **Results are partial** — a leak record with `bankcode: 1X22`, an `organization`, some `tags`.
4. **The player pivots** — the `email` leads to a Hutch profile; the `organization` leads to a corporate site and a breach; a Loop comment or a mail supplies the missing bankcode characters.
5. **The player correlates** — combining fragments across the leak DB, social media, mail, and the browser until the picture (the full bankcode, the responsible actor, the next target) is complete.
6. **The player acts** — files evidence to `/evidence/`, completes a mission step, or uses a recovered bankcode in a heist.

The database's job in this loop is to make every fragment *searchable*, *linked*, and *deliberately incomplete*. The query engine exposes the searches; the cross-dataset links expose the pivots; the leak-event engine keeps new fragments arriving.

---

## 9. Query Engine and Runtime Cache

### 9.1 Query engine

The query engine offers, per dataset: `get(id)`, `find(predicate)`, `search(text, fields)`, `where(field, value)`, and `resolveLinks(record)` for cross-dataset traversal. Datasets carry **indexes** on hot fields (leak `email`, `name`, `organization`, `tags`) so the Leak Viewer's searches are fast over large corpora.

### 9.2 Runtime cache

The runtime cache memoizes query results within a session. It is invalidated on any mutation of the underlying dataset (a leak event, a generated record). The cache is what keeps a heavily-used Leak Viewer responsive; it is ephemeral and never persisted.

### 9.3 Backend sync

`DatabaseService` does not call the backend directly. `persistent`-flagged records and progression-relevant dataset state are handed to `PersistenceService` (`vm-runtime.md` §6.3), which batches writes to the BuckyBot API and re-hydrates them at boot. Authored and generated records are never synced — authored data is in the build, generated data is ephemeral by design.

---

## 10. Important Flows

### 10.1 Flow — a leak event cascades

```
mission step completes → emit mission:state-changed
  → leak-event engine: unseal breach-04 → its leak records enter the leaks dataset
  → cache invalidated for the leaks dataset
  → emit db:record-leaked { breachRef:"breach-04", records:[…] }
  → MailService → breach-alert mail;  fake-internet → Ledger article;
    MissionService → clue chain advances;  desktop → notification
```

### 10.2 Flow — a player looks someone up

```
Leak Viewer: search "tommy@bucky,net"
  → db.search on the leaks dataset, email index
  → returns leak-0142 { name:"Tommy", bankcode:"1X22", organization:"Helix Dynamics", … }
  → player clicks "organization" → resolveLinks → corporate host + breach-04
  → player pivots to bnet://hutch to find the handle for "Tommy"
```

### 10.3 Flow — completing a partial bankcode

```
leak-0142 has bankcode "1X22"  (two chars known, masked)
player finds, in a Loop comment / a mail, the fragment that resolves the mask
  → player concludes bankcode = "1234"
  → OSINT records the correlation; a mission step "recover the bankcode" completes
  → the bankcode is used in a Discord heist (discord-integration.md)
```

### 10.4 Flow — tool output enters the database

```
breachscan run against an organization
  → tool queries db, formats findings, writes /evidence/<case>/findings.log (filesystem)
  → may also register generated leak/intel records via db, tagged with provenance
```

---

## 11. Subsystem Responsibilities

| Component | Responsibility |
|-----------|----------------|
| DatabaseService | Dataset registry, query engine, cache, leak-event engine, tier management, events. |
| Datasets | Typed record collections with schemas and indexes. |
| Query engine | Lookup, search, filtering, cross-dataset link resolution. |
| Runtime cache | Memoized query results; invalidation on mutation. |
| Leak-event engine | Scheduling and firing record exposure; emitting `db:record-leaked`. |
| Tier manager | Authored loading, generated acceptance, persistent promotion. |
| Database / Leak-Viewer app | Player-facing search and record reading. |
| PersistenceService | Serializes/re-hydrates persistent records. |

---

## 12. Dependencies

- **Runtime** — service registry, event bus, storage tiers, persistence.
- **Filesystem** (`filesystem.md`) — tools persist DB-derived findings as files; attachments materialize.
- **Mail** (`mail-system.md`) — the mail dataset; breach-alert generation.
- **Networking & fake internet** (`networking-system.md`, `fake-internet.md`) — the content and hosts datasets; leak events spawn web content.
- **OSINT** (`osint-system.md`) — the osint entity-graph dataset; correlation.
- **Mission & progression / Discord** (`mission-progression.md`, `discord-integration.md`) — mission dataset; leak triggers; bankcode/economy linkage.

---

## 13. Extension Points

- **New dataset** — register a dataset with a schema and indexes; new structured world data with no service changes.
- **New record fields** — schemas are open; add fields (and indexes) as content needs grow.
- **New leak-event trigger** — register a trigger type with the leak-event engine.
- **New index** — add an index to a dataset when a query path becomes hot.
- **Query language** — a richer query/filter DSL for the Leak Viewer.
- **Generated records** — synthesizers that build records from templates (procedural fake users/leaks).
- **Data packs** — ship dataset content in per-arc packs loaded on demand.
- **Snapshots/diffs** — record-level history for tamper-investigation missions.

---

## 14. Scalability Concerns

| Concern | Mitigation |
|---------|------------|
| Thousands of records | Datasets are indexed; the query engine uses indexes; the Leak Viewer virtualizes long result lists (`render-system.md`). |
| Boot cost of large datasets | Authored datasets/data packs lazy-load per arc; not everything loads at boot. |
| Repeated query cost | The runtime cache memoizes; invalidated only on mutation. |
| Leak-event cascades | `db:record-leaked` is one batched event; the render scheduler coalesces downstream re-renders. |
| Persistence size | Only `persistent`-flagged records and progression state are synced; authored/generated data is not. |
| Determinism | Authored records and deterministic leak-event scheduling keep investigations reproducible and missions solvable. |
| Keeping data fictional | Schemas + authoring review; comma-form emails; invented names/orgs only. |

---

## 15. Future Systems

- **Procedural record generation** for large, varied fake populations.
- **A query DSL** and saved searches in the Leak Viewer.
- **Record history/versioning** for tamper- and timeline-investigation missions.
- **Faction/economy datasets** as the Discord integration deepens.
- **Confidence/noise modelling** — red-herring records and source reliability as a teaching mechanic.
- **Cross-session intelligence** — a persistent, account-bound case file of discovered records.
- **A graphical correlation board** built on the cross-dataset link model (`osint-system.md`).

---

## 16. Recommended Implementation Order

1. **Build `DatabaseService`** — the dataset registry, record model, and tier manager.
2. **Build the query engine** — `get`/`find`/`search`/`where` with indexes.
3. **Define and seed the leaks, breaches, and users datasets** — including deliberately partial records (`1X22`, `-`).
4. **Build the Database / Leak-Viewer app** — search and record reading; replace the placeholder app.
5. **Add cross-dataset link resolution** (`resolveLinks`) — the basis of correlation.
6. **Add the runtime cache** with mutation invalidation.
7. **Build the leak-event engine** — triggers and `db:record-leaked`; wire breach-alert mail and Ledger content.
8. **Fold in the mail and content datasets** so MailService and the content providers store through DatabaseService.
9. **Add the osint entity-graph dataset** and hand correlation to `osint-system.md`.
10. **Wire persistence, data packs, and procedural generation** as the corpus scales.

Steps 1–5 deliver a searchable, linkable leak database; steps 6–9 make it a living, event-driven correlation substrate for OSINT and missions.
