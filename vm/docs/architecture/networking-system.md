# Networking System — Architecture Specification

> **Document status:** Source of truth.
> **Scope:** BuckyNet — the simulated network layer: addressing, DNS, the host registry, request routing, and the transport contract for the browser, mail, and tools.
> **Depends on:** `vm-runtime.md`, `database-system.md`.
> **Consumed by:** `browser-system.md`, `fake-internet.md`, `mail-system.md`, `terminal-system.md` (network tools), `osint-system.md`.

---

## 1. Purpose

**BuckyNet** is the fictional internet of the Bucky VM. The networking system is the *transport layer* of that internet: it does for the fake internet what TCP/IP + DNS + HTTP do for the real one — it turns an address into a response. It exists so that the browser, the mail system, and the network tools all speak to one coherent simulated network instead of each inventing its own ad-hoc data lookup.

The networking system exists to:

1. **Provide one addressing scheme.** Every page, host, and service in the fake internet has a BuckyNet address. One scheme, used by the browser's URL bar, by hyperlinks, by mail links, and by tools.
2. **Resolve addresses to content.** A host registry (the fake DNS) maps hostnames to content providers; the router maps a full address to a concrete response.
3. **Simulate a network, not just serve data.** Latency, reachability, host status (online/offline/firewalled), and trace topology are modelled so that network *tools* (scanners, tracers, packet analyzers) have something real-feeling to operate on.
4. **Enforce the sandbox.** BuckyNet is entirely local. The networking system is the hard boundary that guarantees no request ever leaves the browser (`vm-runtime.md` §6.4).

This document covers the *transport*. The *content* of the fake internet (sites, pages, articles, videos, profiles) is specified in `fake-internet.md`; the *browser app* that renders it is specified in `browser-system.md`.

---

## 2. Architecture Overview

### 2.1 The NetworkService

BuckyNet is owned by `NetworkService`, registered as `runtime.services.net`. It is the only component apps and tools use to "go online." Its layers:

```
NetworkService (runtime.services.net)
  ├─ Address parser     bnet:// URL → { scheme, host, path, query, fragment }
  ├─ Host Registry      hostname → host record (the fake DNS + WHOIS source)
  ├─ Router             (host, path) → ContentProvider → Response
  ├─ Network Model      reachability, status, latency, trace topology
  ├─ Request pipeline   middleware: history, gating, latency, logging, events
  └─ Session cache      resolved responses for the session
        │
        ├─ Content Providers  (registered per host; supplied by fake-internet.md)
        └─ emits net:* events on the bus
```

### 2.2 Relationship to content and the browser

- **`fake-internet.md`** registers **content providers** — the things that actually produce page data for a host. NetworkService routes to them; it does not contain page content.
- **`browser-system.md`** is a *client* of NetworkService. The browser sends a request, receives a Response, and renders it. The browser never resolves addresses itself.
- **Tools** (`terminal-system.md`) are *another* client: a scanner enumerates the host registry, a tracer walks the trace topology, a lookup tool reads host records.

This separation means the same simulated network backs the browser, the terminal tools, and OSINT — they all see one consistent BuckyNet.

---

## 3. Addressing

### 3.1 The BuckyNet URL scheme

BuckyNet addresses use the `bnet://` scheme:

```
bnet://<host>/<path>?<query>#<fragment>

bnet://sift                         the Sift search engine home
bnet://sift/results?q=gnawworm      a search results page
bnet://warren/article/gnawworm      a Warren wiki article
bnet://hutch/u/dustfinch            a Hutch social profile
bnet://loop/watch/v-4471            a Loop video page
bnet://helix-dynamics               a corporate site home
bnet://hollow/thread/881            a Hollow forum thread
```

The scheme is deliberately *not* `http://` and hosts are deliberately *not* real domains — this keeps the project rule "no real services or brand names" structurally enforced: a BuckyNet address cannot be confused with a real URL.

### 3.2 Hostnames

A host is a bare, themed name (`sift`, `warren`, `hutch`, `loop`, `hollow`, `ledger`, `helix-dynamics`). The display TLD `.bnet` may be shown for flavor (`sift.bnet`) but the canonical key is the bare host. Hostnames are lowercase, hyphen-delimited, globally unique within BuckyNet.

### 3.3 Address parsing

The address parser is pure and the single interpreter of `bnet://` syntax — analogous to the filesystem path engine. It yields `{ scheme, host, path[], query{}, fragment }`. Malformed addresses produce a structured parse error the browser renders as a "bad address" page.

### 3.4 Mail addressing is separate

Mail does **not** use `bnet://`. Mail addresses use the deliberate comma form `name@host,net` (`tommy@bucky,net`) — see `mail-system.md`. The comma replacing the dot is an intentional anti-realism marker so a VM mail address can never be mistaken for a real email. The networking system and the mail system share the *host registry* (a mail host is a host record) but use different address schemes for different transports.

---

## 4. The Host Registry (Fake DNS + WHOIS)

### 4.1 Purpose

The host registry is BuckyNet's DNS *and* its WHOIS database in one. It maps a hostname to a **host record** describing everything knowable about that host. It is the authoritative directory of the fake internet and the dataset that lookup tools and OSINT read.

### 4.2 Host record model

| Field | Meaning |
|-------|---------|
| `host` | Canonical hostname. |
| `displayName` | Human label (`Warren`, `Helix Dynamics`). |
| `type` | `search`, `wiki`, `social`, `video`, `forum`, `news`, `corporate`, `mail`, `infra`. |
| `provider` | The id of the content provider serving this host (`fake-internet.md`). |
| `status` | `online`, `offline`, `firewalled`, `seized`, `unlisted`. |
| `owner` | The fictional entity/person that owns the host (OSINT-relevant). |
| `registeredAt` | In-universe registration date (WHOIS flavor). |
| `ip` | A simulated address used by scanners/tracers. |
| `ports` | Simulated open "services" for scanner tools. |
| `links` | Other hosts this one is related to (the network graph edges). |
| `gating` | Optional level/mission gate — some hosts are not reachable until unlocked. |
| `tags` | `clue`, `mission:<id>`, `darkweb`, `decommissioned` — used by missions/OSINT. |

### 4.3 Registry as a data source

Because the host record carries `owner`, `registeredAt`, `ip`, and `links`, the registry is simultaneously: the DNS the router uses, the WHOIS dataset the `lookout` tool queries, the host list the `netmapper` scanner enumerates, and a node set in the OSINT entity graph (`osint-system.md`). One dataset, many readers.

---

## 5. Request Routing

### 5.1 The request pipeline

A BuckyNet request flows through an ordered middleware pipeline:

```
request(bnet://…)
  → parse address
  → resolve host in the registry        (unknown host → "host not found" response)
  → reachability check (status/gating)  (offline/firewalled/locked → error response)
  → latency simulation                  (a modelled delay; the browser shows loading)
  → route to the host's ContentProvider with (path, query, fragment)
  → provider returns a Response
  → post-process: history, logging, events
  → return Response
```

### 5.2 Response model

| Field | Meaning |
|-------|---------|
| `status` | `ok`, `not-found`, `host-unreachable`, `forbidden`, `bad-address`. |
| `address` | The canonical resolved address. |
| `contentType` | `page`, `search-results`, `video`, `profile`, `thread`, `feed`, `error`. |
| `payload` | The structured content the browser renders (page model — `browser-system.md`). |
| `meta` | Title, host display name, breadcrumbs. |
| `latency` | The simulated round-trip time used for loading UX. |
| `trace` | Optional node path (for the tracer tool). |

The Response is **structured data**, not HTML. The browser turns the payload into DOM (`browser-system.md`); a tool consumes the same Response programmatically. This is why the network layer can serve both a human browser and an automated scanner.

### 5.3 Content providers

A **content provider** is a registered module that serves one host or one class of host. It receives `(path, query, fragment)` and returns a Response payload. Providers are supplied by `fake-internet.md` (the search engine provider, the wiki provider, the social provider, the corporate-site provider, …). NetworkService owns *routing*; providers own *content*. Adding a new site to BuckyNet = adding a host record + (re)using a provider — no change to NetworkService.

---

## 6. The Network Model (for Tools)

The browser only needs request/response. Network *tools* need a network to explore. The network model adds:

- **Reachability** — `status` per host: scanners report online/offline; firewalled hosts resist; seized hosts show takedown notices.
- **Topology / trace graph** — hosts are nodes; `links` and infra hosts (routers, relays) are edges. `tracekit` walks this graph to render a route; `netmapper` enumerates a neighborhood.
- **Simulated services** — `ip` + `ports` give scanners concrete (fictional) findings.
- **Traffic** — for the packet analyzer (`buckyshark`), the model can generate a deterministic stream of simulated packets associated with a host/session.
- **Latency** — per-host delay so the network *feels* physical and tools can report timings.

All of this is **deterministic** authored data (or a deterministic function of it), so a scan today and a scan tomorrow agree, and missions built on scan results are reliably solvable.

---

## 7. Important Flows

### 7.1 Flow — the browser loads a page

```
browser request("bnet://warren/article/gnawworm")
  → parse → host "warren" → registry record (type wiki, provider warren-provider, status online)
  → reachability ok → latency delay
  → route to warren-provider with path ["article","gnawworm"]
  → provider returns Response { contentType:"page", payload:{…article model…} }
  → pipeline records history, emits net:navigated
  → browser renders the payload
```

### 7.2 Flow — a search

```
browser request("bnet://sift/results?q=gnawworm")
  → host "sift" (search) → sift-provider
  → provider queries the search index (fake-internet.md) for "gnawworm"
  → Response { contentType:"search-results", payload:{ results:[ {address,title,snippet}… ] } }
  → browser renders the results list; each result links to a bnet:// address
```

### 7.3 Flow — an unreachable host

```
request("bnet://helix-dynamics/internal")
  → registry: helix-dynamics status "firewalled" for path /internal
  → reachability fails → Response { status:"forbidden", contentType:"error" }
  → browser renders an access-denied page; a mission may key off this state
```

### 7.4 Flow — a tool uses the network

```
netmapper scan helix-dynamics
  → tool calls net.scan("helix-dynamics")  (a tool-facing NetworkService method)
  → NetworkService returns the host record's ip/ports/status + linked hosts
  → tool formats findings, writes /scans/helix-dynamics/hosts.json (filesystem.md §5.3)
```

### 7.5 Flow — a locked host unlocks

```
mission completes → unlock flag synced → host "hollow" gating cleared
  → next request to bnet://hollow resolves instead of returning forbidden
  → a clue chain that needed the forum is now traversable
```

---

## 8. Data Models Summary

| Model | Owner | Notes |
|-------|-------|-------|
| BuckyNet address | Address parser | `bnet://host/path?query#fragment` |
| Host record | Host registry | DNS + WHOIS + scanner data + graph node (§4.2) |
| Response | Request pipeline | Structured, content-typed (§5.2) |
| Content provider | Registered by `fake-internet.md` | `(path,query)→payload` |
| Trace graph | Network model | Nodes = hosts/infra, edges = `links` |
| Session cache | NetworkService | Resolved responses, cleared on refresh |

---

## 9. Subsystem Responsibilities

| Component | Responsibility |
|-----------|----------------|
| NetworkService | Owns addressing, the registry, routing, the network model, the request pipeline. |
| Address parser | Sole interpreter of `bnet://` syntax. |
| Host registry | Hostname → host record; DNS + WHOIS source. |
| Router | (host, path) → provider → Response. |
| Content providers | Produce content payloads (defined in `fake-internet.md`). |
| Network model | Reachability, topology, simulated services, traffic, latency. |
| Browser | A client: requests and renders Responses (`browser-system.md`). |
| Network tools | Clients: scan/trace/inspect via tool-facing NetworkService methods. |

---

## 10. Dependencies

- **Runtime** — service registration, the event bus (`net:*` events).
- **Database system** (`database-system.md`) — host records, the search index, and site content datasets are stored/served as datasets; the registry and providers read them.
- **Fake internet** (`fake-internet.md`) — supplies content providers and site content.
- **Session/mission services** — host gating; unlock-driven reachability.
- **Filesystem** (`filesystem.md`) — tools persist network output as files.

NetworkService depends on no app. The browser and tools depend on NetworkService.

---

## 11. Extension Points

- **New host** — add a host record; point it at an existing or new provider.
- **New host type / provider** — register a content provider for a new class of site.
- **New response content type** — add a type and the browser renderer for it.
- **Pipeline middleware** — insert request middleware (rate flavor, mission interception, packet generation) without touching routing.
- **Network model depth** — richer topology, autonomous infra hosts, dynamic status changes driven by events.
- **Protocol variants** — a `bnet-secure://` or an in-universe "darknet" addressing space gated behind progression.
- **Tool-facing API growth** — new methods for new tool classes (DNS enumeration, port history, traffic capture).

---

## 12. Scalability Concerns

| Concern | Mitigation |
|---------|------------|
| Hundreds of hosts/pages | The registry is keyed data; providers generate pages on demand; nothing is rendered until requested. |
| Eagerly loading all content | Content datasets are lazy-loaded per host/provider, not at boot. |
| Repeated resolution cost | Session cache memoizes resolved Responses. |
| Determinism across sessions | Registry and content are authored data; the network model is deterministic so tools and missions are reproducible. |
| Coupling content to transport | Hard split: NetworkService routes, providers produce; new sites never touch the router. |
| Sandbox integrity | The only `request` implementation is local; there is no code path to real HTTP from inside BuckyNet. |

---

## 13. Future Systems

- **Dynamic network events** — hosts going offline/seized as missions or leak events fire, changing what is reachable.
- **Darknet tier** — a gated addressing space for late-game OSINT.
- **Authenticated sessions** — fake login state on social/corporate hosts, unlocking private pages.
- **Packet/traffic simulation depth** for an advanced `buckyshark`.
- **In-universe certificate / trust flavor** for teaching-oriented security missions.
- **Network map app** — a graphical view of the trace topology.

---

## 14. Recommended Implementation Order

1. **Define the `bnet://` scheme and the address parser.**
2. **Build the host registry** and the host record model; seed the first hosts.
3. **Build NetworkService routing** — registry resolution → content provider → Response — and register it as `runtime.services.net`.
4. **Define the Response model** and the content-provider contract (with `fake-internet.md`).
5. **Add the request pipeline** — history, latency, `net:*` events.
6. **Wire the Browser app** as the first client (`browser-system.md`).
7. **Add the network model** — status, topology, simulated services — for the first network tools.
8. **Expose tool-facing methods** for `netmapper`/`lookout`/`tracekit` (`terminal-system.md`).
9. **Add host gating** so missions can lock/unlock parts of BuckyNet.
10. **Add dynamic network events and the darknet tier** as content and missions scale.

Steps 1–6 deliver a navigable fake internet for the browser; steps 7–10 make it a network the cybersecurity tools and missions can operate on.
