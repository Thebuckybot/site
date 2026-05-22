# Mail System — Architecture Specification

> **Document status:** Source of truth.
> **Scope:** The Mail app and `MailService` — mailboxes, messages, threading, addressing, event-driven mail, and mail as a mission/clue surface.
> **Depends on:** `vm-runtime.md`, `app-system.md`, `database-system.md`, `mission-progression.md`, `discord-integration.md`.
> **Consumed by:** the player; `mission-progression.md`, `osint-system.md`.

---

## 1. Purpose

The mail system is the Bucky VM's messaging layer — the in-universe email client and the inbox the player works out of. It is one of the primary channels through which the game *talks to the player*: briefings, alerts, leads, leaked information, and clues all arrive as mail.

The mail system exists to:

1. **Deliver narrative and missions.** Mission briefings, intel-desk messages, breach alerts, and follow-ups are mail. The inbox is a storytelling and objective-delivery surface.
2. **Carry clues.** Mails embed hints, references, links to BuckyNet pages and files, and economy codes (bankcodes). Reading mail carefully is gameplay.
3. **React to the world.** Mail is event-driven: a leak event, a completed mission, or a scan result can generate a message automatically.
4. **Stay readable.** The inbox is deliberately kept small — about five active messages visible — so the player is never overwhelmed and every message matters.
5. **Stay strictly fictional.** No real email addresses or domains. Addresses use the deliberate comma form `name@bucky,net`.

---

## 2. Addressing — the comma domain

### 2.1 The rule

VM mail addresses use the form:

```
name@host,net
```

The separator before the TLD is a **comma**, not a dot. This is intentional and mandatory. Examples:

```
tommy@bucky,net
inteldesk@bucky,net
breach-alerts@bucky,net
```

There is **no `.com`, no dot-separated TLD, and no real domain anywhere** in the mail system.

### 2.2 Why the comma

The comma is a deliberate anti-realism marker. It guarantees a VM mail address can never be confused with — or accidentally function as — a real email address. It is the mail-system equivalent of the browser's `bnet://` scheme: a structural enforcement of the project rule "no real services or domains." Every address the mail system stores, displays, validates, or generates uses the comma form. An address with a dot before the TLD is invalid input.

### 2.3 Default domain and hosts

The default mail host is `bucky,net`. Other in-universe hosts may appear (`bucky-security,net`, a corporate `helix-dynamics,net`) — always comma-formed. Mail hosts correspond to host records in the network registry (`networking-system.md` §4) so a mail domain and a website host can be cross-referenced in an investigation, while remaining distinct address schemes for distinct transports.

### 2.4 Address model

| Field | Meaning |
|-------|---------|
| `local` | The part before `@` (`tommy`, `inteldesk`, `breach-alerts`). |
| `host` | The comma-domain (`bucky,net`). |
| `display` | Optional display name (`Bucky Intel Desk`). |
| `accountRef` | Optional link to a VM account / Discord-linked identity (§7). |

---

## 3. Architecture Overview

### 3.1 MailService

Mail is owned by `MailService`, registered as `runtime.services.mail`. The Mail app is a thin client over it.

```
Mail app (apps/MailApp.js)  — single-instance
  ├─ Mailbox views   Inbox, Sent, (future: Drafts, Archive)
  ├─ Message reader  renders a message; resolves links/attachments
  └─ Composer        compose / reply (future-complete)
        │  uses
        ▼
MailService (runtime.services.mail)
  ├─ Mailboxes       Inbox / Sent / … per account
  ├─ Message store   message records (the mail database)
  ├─ Threading       groups messages into conversations
  ├─ Addressing      parse/validate the comma form
  ├─ Generators      event-driven and mission-driven message creation
  └─ emits mail:* events on the bus
```

### 3.2 Storage

Messages are records in the **mail database** (`database-system.md`). MailService is the access layer; DatabaseService is the store. Authored/seed mail ships with the build; generated mail is created at runtime; mission-critical mail can be promoted to the persistent tier so it survives a refresh (`vm-runtime.md` §6.2).

---

## 4. Data Models

### 4.1 Message model

| Field | Meaning |
|-------|---------|
| `id` | Unique message id. |
| `threadId` | Conversation this message belongs to (§6). |
| `from` | Sender address (comma form). |
| `to[]` | Primary recipient addresses. |
| `cc[]` | Carbon-copy recipient addresses. |
| `subject` | Subject line. |
| `body` | Message text (supports inline links and references). |
| `sentAt` | Timestamp (session clock — see §4.4). |
| `read` | Whether the player has opened it. |
| `mailbox` | `inbox`, `sent`, `archive`, `drafts`. |
| `priority` | `normal`, `high`, `alert` — drives inbox styling. |
| `source` | Provenance — `authored`, `event:<type>`, `mission:<id>`, `composed`. |
| `links[]` | References to BuckyNet pages and files (§5). |
| `attachments[]` | Attached artifacts (§5.3). |
| `hints[]` | Embedded hint descriptors (§8). |
| `tags[]` | `briefing`, `alert`, `clue`, `mission:<id>`, `economy`. |
| `flags` | `persistent`, `pinned`, `system`. |

### 4.2 Mailbox model

A mailbox is an ordered, filtered view over the message store for one account: `inbox`, `sent`, and (future) `drafts`, `archive`. The Inbox is special-cased by the **active-inbox limit** (§9).

### 4.3 Account model

A mail account binds an address to the player. The default account is `<username>@bucky,net`, derived from the linked identity (`session` service). Additional accounts (mission aliases, a corporate account obtained mid-investigation) are possible; each has its own mailboxes.

### 4.4 Timestamps

`sentAt` uses the **session/in-universe clock**, not wall-clock real time, so the timeline of an investigation is coherent and deterministic. Seed mail carries authored timestamps establishing a believable history; generated mail is stamped at the in-universe moment of the triggering event.

---

## 5. Message Linking and Attachments

### 5.1 Links to BuckyNet pages

A message `body`/`links` may reference `bnet://` addresses. The reader renders these as clickable links; activating one issues an `open-url` intent to the Browser (`browser-system.md` §5.2, `app-system.md` §8.3). This is a core flow: an intel mail points the player at a Warren article, a Hutch profile, or a corporate site to begin an investigation.

### 5.2 Links to files

A message may reference a filesystem path. The reader renders it as a link that opens the file in its mime-appropriate app (BuckyCode, the Files app, a viewer). A briefing can thus hand the player a file at a known path, or instruct them to save something to one.

### 5.3 Attachments

An attachment is an artifact carried by a message: a logical file (with `name`, `mime`, content) or a reference to a database record (a leak record, a scan result). Opening an attachment **materializes it into the filesystem** — typically under `/mail/attachments/` or `/downloads/` — so it becomes a first-class file other apps and tools can use. Attachments are the bridge from the inbox into the filesystem and OSINT.

### 5.4 Cross-system references

Through links and attachments a single mail can tie together the browser, the filesystem, the database, and OSINT: "see the attached leak record, cross-reference the handle on `bnet://hutch`, and file your findings in `/evidence/`." Mail is frequently the *opening move* of a clue chain (`mission-progression.md`).

---

## 6. Threading

Messages with the same `threadId` form a **conversation**. The reader can display a thread as an ordered exchange; the Inbox shows a thread as a single entry (its latest message) to conserve the active-inbox budget (§9). Replies inherit the `threadId`; a new subject starts a new thread. Threading is specified now as part of the model so the Inbox limit and the reader are built thread-aware from the start, even if a flat v1 ships first.

`cc[]` is part of the model from the outset: carbon-copy recipients are stored, displayed in the reader, and respected by reply-all. CC is also a clue surface — *who else was copied* on a message can itself be intel.

---

## 7. Discord Account Linking

The VM is launched with an authenticated Discord identity (`session` service, `discord-integration.md`). The mail system binds that identity to a VM mail account:

- The player's default account is `<username>@bucky,net`, derived from the linked Discord user.
- Persistent mailbox state (which mission mails have been received, which are read) is keyed to the Discord account and synced via `PersistenceService`, so a returning player's inbox reflects their progression.
- The Discord bridge can *target mail at a specific player*: a mission or economy event in the Discord ecosystem causes MailService to generate a message addressed to that account (§8.2). This is how the Discord side "sends mail" into the VM.
- Multiple linked players each have their own account namespace; mail is never cross-delivered.

The mail system does not talk to Discord directly — it reacts to progression/event data delivered through `PersistenceService` and the Discord bridge (`discord-integration.md`).

---

## 8. Event-Driven and Mission Mail

### 8.1 Generators

MailService owns **message generators** — functions that construct a message from a template plus event data. Generators keep generated mail consistent in tone, addressing, and structure. A generator is registered per event type.

### 8.2 Triggers

Mail is generated automatically in response to:

| Trigger | Example message |
|---------|-----------------|
| Mission state change | A briefing when a mission opens; a follow-up when a step completes. |
| Leak / breach event (`database-system.md`) | `breach-alerts@bucky,net` reports a new leak; links the affected corporate page. |
| Tool result | `inteldesk@bucky,net` summarizes a scan and points to the next lead. |
| Progression / economy event (Discord) | A reward notice, a bankcode delivery, a heist briefing. |
| Time / session events | A welcome message on first session; periodic intel digests. |

Generators subscribe to bus events (`mission:state-changed`, `db:record-leaked`, `progression:level-changed`, …); on a matching event they construct the message, file it into the Inbox, and emit `mail:received`, which raises a notification (`desktop-shell.md`).

### 8.3 Hints, clues, and bankcodes in mail

Mail is a primary hint surface. A message's `hints[]` carry the same hint descriptors as BuckyNet content (`fake-internet.md` §7):

- **Clues** — a name, a handle, a `bnet://` address, an instruction needed to advance.
- **References** — a pointer to a file, a page, a database record to correlate.
- **Bankcodes** — a hint of kind `bankcode` carries an economy code (e.g. `1X22`, `1234`). Bankcodes link the VM to the Discord economy and heists (`discord-integration.md`); a mail delivering a bankcode is a deliberate, central mechanic. (Note that a leak record's `bankcode` may be partial or unknown — `-` — so a mail's bankcode and a leaked bankcode are pieces a player must *correlate*; see `database-system.md`.)

When the player opens a message carrying a hint, MailService emits `mail:hint-revealed`; the mission system marks the clue discovered (`mission:clue-found`). The mail system holds no mission logic — it surfaces hints and reports that they were read.

---

## 9. The Active-Inbox Limit

The Inbox deliberately shows **about five active messages**. This is a design constraint, not a storage limit:

- The Inbox view caps the number of visible active (non-archived) threads at ~5.
- When generated mail would exceed the cap, the **oldest, lowest-priority, fully-read** thread is auto-archived (moved to `archive`, not deleted) to make room. Archived mail remains retrievable.
- `pinned`/`alert`/unread mission-critical mail is exempt from auto-archival — important messages are never pushed out by flavor mail.
- Generators are expected to be economical: prefer updating/threading an existing conversation over spawning a new top-level message.

The effect: the Inbox always reads as a focused, curated worklist of what matters *now*, while history is preserved in Archive. This keeps the mission-delivery surface legible as the game produces hundreds of messages over a campaign.

---

## 10. Important Flows

### 10.1 Flow — a mission briefing arrives

```
mission opens → emit mission:state-changed
  → MailService briefing generator builds a message from inteldesk@bucky,net
  → message filed to Inbox; active-inbox limit enforced (oldest read thread archived if needed)
  → emit mail:received → notification "New mail: Mission briefing"
player opens it → read=true; body links to a bnet:// page and a /evidence/ path
```

### 10.2 Flow — a breach alert with a clue

```
leak event fires → emit db:record-leaked
  → breach-alert generator builds a message from breach-alerts@bucky,net
  → message carries a hint { kind:"reference", value:"<corporate host>" } and a bnet:// link
  → mail:received
player opens it, follows the link → Browser opens the corporate page
  → mail:hint-revealed → mission:clue-found
```

### 10.3 Flow — an attachment becomes a file

```
player opens a message with a leak-record attachment
  → "open attachment" → MailService materializes it into /mail/attachments/<name>.json
  → emit fs:node-created → the file is now usable by breachscan, OSINT, BuckyCode
```

### 10.4 Flow — a bankcode delivery

```
Discord economy/mission event → progression data synced via PersistenceService
  → MailService generates a message carrying a hint { kind:"bankcode", value:"1X22" }
  → mail:received; player reads the code
  → the code is used in a heist/economy step on the Discord side (discord-integration.md)
```

---

## 11. Subsystem Responsibilities

| Component | Responsibility |
|-----------|----------------|
| MailService | Mailboxes, the message store interface, threading, addressing, generators, events. |
| Mail app | Inbox/Sent views, the message reader, the composer. |
| Address parser | Validates/parses the comma form; rejects dot-TLD input. |
| Generators | Build event- and mission-driven messages from templates. |
| Active-inbox manager | Enforces the ~5-message visible cap; auto-archives. |
| DatabaseService | Stores message records (the mail database). |
| PersistenceService | Syncs per-account mailbox state for returning players. |

---

## 12. Dependencies

- **Runtime** — service registry, event bus (`mail:*`).
- **Database system** (`database-system.md`) — the mail database stores messages; leak events trigger mail.
- **App system** (`app-system.md`) — the Mail app; `open-url`/`open-file` intents.
- **Browser & filesystem** — link and attachment targets.
- **Mission & progression** (`mission-progression.md`) — mission triggers; clue discovery.
- **Discord integration** (`discord-integration.md`) — account linking; economy/bankcode mail.
- **Session service** — the linked identity behind the default account.

---

## 13. Extension Points

- **New generator** — register a generator for a new event type; new automatic mail with no app changes.
- **New mailbox** — Drafts, Archive views, custom folders are filtered views over the store.
- **Composer / reply** — full send semantics (the model already supports `to`/`cc`/threads).
- **New hint kinds** — extend hint handling shared with `fake-internet.md`.
- **Rich attachments** — images, signed documents, encrypted attachments needing a key.
- **Filters and search** — querying the message store by sender, tag, thread.
- **Multiple accounts** — per-mission or per-faction inboxes.
- **Mail rules** — auto-tagging/auto-archiving rules echoing the rule-builder concept elsewhere in the site.

---

## 14. Scalability Concerns

| Concern | Mitigation |
|---------|------------|
| Hundreds of campaign messages | Inbox capped at ~5 active threads; the rest auto-archived, retrievable, never deleted. |
| Inbox clutter from flavor mail | Generators thread/update rather than spawn; priority exemptions protect mission mail. |
| Rendering long threads/mailboxes | Reader paginates threads; mailbox lists use keyed reconciliation (`render-system.md`). |
| Generated-mail consistency | All generated mail goes through registered generators/templates. |
| Persistence size | Only `persistent`-flagged mail and per-account read/received state are synced. |
| Address correctness | A single comma-form parser is the only validator; dot-TLD input is rejected everywhere. |
| Determinism | Generators are deterministic over event data; in-universe timestamps keep timelines coherent. |

---

## 15. Future Systems

- **Composer and full reply/reply-all** with thread continuation.
- **Drafts and Archive** as first-class mailbox views with search and filters.
- **Encrypted mail/attachments** requiring a key from a mission or `decrypt`.
- **Mail rules / auto-tagging.**
- **Multiple accounts** for multi-faction or undercover missions.
- **Spam / phishing simulation** — an educational mechanic teaching the player to spot malicious mail.
- **Mail-driven mini-investigations** — header inspection, sender verification as OSINT.

---

## 16. Recommended Implementation Order

1. **Define the message and address models**; build the comma-form address parser/validator.
2. **Build `MailService`** with an Inbox and a message store backed by the mail database.
3. **Build the Mail app** — Inbox list + message reader; replace the placeholder app.
4. **Add the active-inbox limit** and auto-archival with priority exemptions.
5. **Add message linking** — clickable `bnet://` links (Browser intents) and file links.
6. **Add generators and event triggers** — mission briefings and breach alerts first.
7. **Add the hint layer** — embedded clues and bankcodes; emit `mail:hint-revealed`.
8. **Add attachments** and attachment-to-filesystem materialization.
9. **Add threading and CC display**; then the composer and Sent.
10. **Wire Discord account linking and persistence** so returning players see a coherent inbox; add filters, search, and multi-account later.

Steps 1–4 deliver a curated, readable inbox; steps 5–8 make it a clue-bearing mission surface; steps 9–10 complete messaging and tie it to progression.
