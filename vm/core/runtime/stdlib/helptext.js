/**
 * Help metadata — in-VM documentation for `help()` and `dir(module, True)`
 * (Phase 4.5 hardening, discoverability).
 *
 * Pure data: one entry per bucky.* module. `description` is a one-line summary;
 * `methods` maps a method SIGNATURE to a one-line doc; `example` is a runnable
 * snippet. Kept here (not on the modules) so the runtime stays lean and the help
 * text is editable in one place. `help()` and `dir()` read from this map, and so
 * does bucky://docs.
 *
 * THIS MAP IS PROSE, NEVER THE INVENTORY. The list of modules and members comes
 * from the live module table (core/runtime/docs.js); this file only says what
 * each one is FOR. That split matters, because by the time anything checked,
 * this map had drifted badly: it documented a `notify.notify` that does not
 * exist, had no entry at all for terminal / ui / database / missions, left
 * twenty members undescribed, claimed mail could not send when it had been
 * sending since Phase 5.0, and four of its runnable examples used a semicolon
 * this interpreter rejects — so copying them produced a SyntaxError out of the
 * help system itself.
 *
 * `helpDrift()` measures all of that and a guard in
 * tests/phase45b_regression.mjs holds it at zero. A module without an entry
 * still lists its members; it just says out loud that the prose is missing
 * instead of leaving a gap that reads like completeness.
 */
export const HELP = {
    profile: {
        description: "Read-only operator identity & economy (self-view snapshot).",
        methods: {
            "me()": "Full self-view dict: level, xp, coins, bank, networth, organization, exposures.",
            "level()": "Operator level (int).",
            "prestige()": "Prestige rank (int).",
            "xp()": "Experience points (int).",
            "coins()": "Spendable coins (int).",
            "bank()": "Banked coins (int).",
            "networth()": "Total net worth (int).",
            "inventory_count()": "Number of items held (int).",
            "organization()": "Your organisation dict, or None.",
            "reputation()": "Your org reputation (int).",
            "exposures()": "Your recorded exposure list.",
            "titles()": "Cosmetic titles you own (list).",
            "summary()": "Compact dict of the headline fields.",
            "refresh()": "Re-fetch your self-view for this run."
        },
        example: "print('Level', profile.level(), 'Coins', profile.coins())"
    },
    leaks: {
        description: "OSINT leak archive (read-only; leaks are triggered via Discord).",
        methods: {
            "latest([limit])": "Recently exposed operators, newest first.",
            "recent([limit])": "Alias of latest().",
            "mine()": "Your own exposure history.",
            "incidents()": "The incident index.",
            "incident(id)": "One incident record by LEAK-id, or None.",
            "search(query)": "Operators matching handle / incident / severity.",
            "bySeverity(sev)": "Operators at a severity (low|medium|high|severe).",
            "statistics()": "Headline counts.",
            "stats()": "Alias of statistics().",
            "refresh()": "Re-fetch the leak snapshot for this run."
        },
        example: "for o in leaks.latest(5):\n    print(o['handle'], o['severity'])"
    },
    organizations: {
        description: "The organisation registry (read-only; alias: orgs).",
        methods: {
            "current()": "Your organisation, or None.",
            "mine()": "Alias of current().",
            "list()": "Every organisation.",
            "get(id)": "One organisation by id or name, or None.",
            "search(query)": "Organisations matching id/name/tagline/description.",
            "members(id)": "Member count for an org (or yours).",
            "leaderboard()": "Orgs ranked by reputation then members.",
            "refresh()": "Re-fetch the organisation snapshot for this run."
        },
        example: "for o in orgs.list():\n    print(o['name'], o['members'])"
    },
    leaderboards: {
        description: "Grid rankings (read-only). Kinds: richest, level, org-reputation, most-leaked.",
        methods: {
            "kinds()": "Available leaderboard kinds.",
            "top(kind[, limit])": "Ranked rows for a kind.",
            "rank(kind)": "Your 1-based rank in a kind, or None.",
            "organizations()": "The organisation leaderboard.",
            "richest([limit])": "Top operators by net worth.",
            "levels([limit])": "Top operators by level.",
            "reputation([limit])": "Top organisations by reputation.",
            "mostLeaked([limit])": "Most-exposed operators.",
            "most_leaked([limit])": "Alias of mostLeaked().",
            "level([limit])": "Alias of levels().",
            "format([kind[, limit]])": "A board as aligned text (string), without printing.",
            "table([kind[, limit]])": "Alias of format().",
            "render([kind[, limit]])": "Print a board as an aligned table.",
            "pretty([kind[, limit]])": "Alias of render()."
        },
        example: "for r in leaderboards.richest(5):\n    print(r['rank'], r['user_id'])"
    },
    economy: {
        description: "Operator economy. Reads are free; transfers route through Discord.",
        methods: {
            "balance()": "Spendable coins (int).",
            "bank()": "Banked coins (int).",
            "networth()": "Total net worth (int).",
            "summary()": "{ coins, bank, networth }.",
            "transfer(to, amount)": "NOT available in the VM — routes to Discord (raises)."
        },
        example: "print(economy.summary())"
    },
    inventory: {
        description: "Operator items (read-only).",
        methods: {
            "items()": "Every item you hold.",
            "has(name)": "True when you hold an item with that name.",
            "search(query)": "Items matching name/type/category/description.",
            "count([name])": "Total items, or the quantity of one named item."
        },
        example: "print('Items:', inventory.count())"
    },
    security: {
        description: "Security posture (read-only): firewall, exposures, breach state.",
        methods: {
            "status()": "{ breached, exposures, firewall, score, posture }.",
            "firewall()": "{ enabled, active, tier, level } from your firewall_level.",
            "exposures()": "Your recorded exposures.",
            "breached()": "True when you appear in the live leak archive."
        },
        example: "s = security.status()\nprint(s['posture'], s['score'])"
    },
    process: {
        description: "The session process table (ps/jobs/top read the same data).",
        methods: {
            "list()": "Every process (alias: ps()).",
            "active()": "Running/waiting/sleeping processes (alias: jobs()).",
            "get(pid)": "One process record, or None.",
            "current()": "The calling script's own process.",
            "pid()": "The calling script's PID.",
            "kill(pid)": "Terminate a process (True/False).",
            "killall(name)": "Terminate every active process with that name (count).",
            "stats()": "Counts by state.",
            "ps()": "Alias of list().",
            "jobs()": "Alias of active()."
        },
        example: "print('Active:', len(process.active()))"
    },
    table: {
        description: "Aligned text tables. render() prints + returns; format() returns only.",
        methods: {
            "render(rows[, columns])": "Print and return an aligned table from dicts/lists.",
            "format(rows[, columns])": "Return the rendered table text without printing."
        },
        example: "table.render([{'name':'Tommy','level':57}])"
    },
    form: {
        description: "Interactive prompts (need the interactive Terminal).",
        methods: {
            "select(prompt, options)": "Numbered choice; returns the chosen option, or None.",
            "confirm(prompt)": "Yes/no; returns True/False.",
            "ask(prompt)": "Free-text; returns the typed string.",
            "input(prompt)": "Alias of ask()."
        },
        example: "choice = form.select('Target', ['a','b','c'])"
    },
    menu: {
        description: "Interactive numbered menu (needs the interactive Terminal).",
        methods: {
            "show(items[, title])": "Returns { index, label, value } for the choice, or None."
        },
        example: "sel = menu.show(['Scan','Reports','Exit'], 'Main')\nprint(sel['label'])"
    },
    status: {
        description: "Bordered status blocks. Both methods print and return their text.",
        methods: {
            "card(title, fields)": "A ruled block of key/value fields (dict or kwargs).",
            "line(label, value)": "A single 'label: value' line."
        },
        example: "status.card('STATS', {'level': 57, 'coins': 1200})"
    },
    progress: {
        description: "A [#####-----] progress bar that also feeds the process table.",
        methods: {
            "start(label[, total])": "Begin a bar; returns a handle.",
            "update(value[, label])": "Advance the bar (percent or value/total).",
            "finish([label])": "Complete the bar at 100%.",
            "bar(percent)": "Return the bar string without printing."
        },
        example: "progress.start('Scan')\nprogress.update(50)\nprogress.finish()"
    },
    notify: {
        description: "Post a VM notification (desktop toast when available) + an inline line.",
        methods: {
            "send(text[, level])": "level: info | warn | alert. The bare name `notify(...)` IS this one.",
            "info/warn/alert(text)": "Level-specific shortcuts (bucky.notify)."
        },
        example: "notify('Leak detected', 'alert')"
    },
    report: {
        description: "Report builders + the export engine (alias: reports).",
        methods: {
            "text(title, body)": "A titled, ruled text block (string).",
            "create(title, body)": "Alias of text().",
            "table(title, rows[, cols])": "A titled aligned table (string).",
            "json(obj)": "Pretty-printed JSON (string).",
            "save(path, content)": "Write content to a VFS path; returns the path.",
            "to_reports(name, content)": "Write into /projects/reports/<name>.",
            "to_exports(name, content)": "Write into /projects/exports/<name>.",
            "to_archives(name, content)": "Write into /projects/archives/<name>."
        },
        example: "report.to_reports('out.txt', report.table('Top', leaderboards.richest(5)))"
    },
    watchlist: {
        description: "Operator/org/incident watchlists, persisted to /projects/data.",
        methods: {
            "add_operator(handle)": "Watch an operator.",
            "add_org(id)": "Watch an organisation.",
            "add_incident(id)": "Watch an incident.",
            "remove(category, value)": "Remove an entry.",
            "list([category])": "List the watchlist (or one category).",
            "has(category, value)": "Membership test.",
            "clear([category])": "Clear all (or one category).",
            "check()": "Cross-reference the watchlist against the live leak archive."
        },
        example: "watchlist.add_operator('Tommy')\nprint(watchlist.check())"
    },
    search: {
        description: "Global query across leaks / organisations / players.",
        methods: {
            "leaks(query)": "Exposed operators matching the query.",
            "orgs(query)": "Organisations matching the query.",
            "players(query)": "Known operators by handle (deduped).",
            "all(query)": "{ leaks, orgs, players }."
        },
        example: "print(search.all('null'))"
    },
    hackbank: {
        description: "HackBank client foundation. Authority stays Discord; the VM only inspects.",
        methods: {
            "owned()": "True when you can run HackBank (own >=1 attack script via Discord).",
            "available()": "owned() AND off cooldown.",
            "cooldown()": "Seconds remaining (0 = ready).",
            "status()": "{ owned, available, cooldown, note }.",
            "run(target)": "NOT available in the VM — routes to Discord (raises)."
        },
        example: "if hackbank.available(): print('ready')"
    },
    mail: {
        description: "Your Bucky Mail mailbox — read and send, the same one the Mail app shows.",
        methods: {
            "identity()": "Your <username>@bucky.net address.",
            "available()": "True when the mailbox is reachable from this run.",
            "inbox_count()": "Messages in the inbox.",
            "unread_count()": "Unread messages in the inbox.",
            "inbox([limit])": "Recent inbox messages, newest first.",
            "sent([limit])": "Recent sent messages, newest first.",
            "unread()": "Only the unread inbox messages.",
            "read(id)": "Open one message (marks it read) and return it.",
            "attachments(id)": "Attachment metadata for a message — no payload.",
            "send(to, subject, body, cc=, bcc=)": "Send a message. Attachments via attachments=[...].",
            "search(query)": "NOT available — search arrives in a later phase (raises)."
        },
        example: "print('My address:', mail.identity())\nprint(mail.unread_count(), 'unread')"
    },
    events: {
        description: "Runtime-event registration (architecture only; dispatch is deferred).",
        methods: {
            "list()": "The event vocabulary (on_leak, on_mail, on_incident, on_mission, on_levelup).",
            "on(event, handler)": "Register a handler (stored, not yet dispatched).",
            "registered()": "Handler counts per event."
        },
        example: "def my_handler(e):\n    print('leak', e)\nevents.on('on_leak', my_handler)"
    },
    schedule: {
        description: "Automation scheduling foundation (architecture only; no execution yet).",
        methods: {
            "cadences()": "['once','hourly','daily','weekly'].",
            "hourly/daily/weekly/once(name, fn)": "Declare a task on a cadence.",
            "list()": "Declared tasks."
        },
        example: "schedule.daily('nightly_report', None)"
    },
    files: {
        description: "The VM virtual filesystem (shared with the Files app and Terminal).",
        methods: {
            "read(path)": "File contents (string).",
            "write(path, text)": "Write a file (creates parents).",
            "append(path, text)": "Append to a file.",
            "delete(path)": "Delete a file/dir.",
            "list([path])": "Directory entry names.",
            "exists(path)": "Existence test.",
            "isdir(path)": "Directory test.",
            "mkdir(path)": "Create a directory.",
            "copy(src, dst)": "Copy a file.",
            "move(src, dst)": "Move a file.",
            "remove(path)": "Alias of delete().",
            "listdir([path])": "Alias of list()."
        },
        example: "files.write('/projects/data/note.txt', 'hello')"
    },
    terminal: {
        description: "Write straight to the terminal, and read a line back from it.",
        methods: {
            "print(*args)": "Like print(), but always to the terminal.",
            "line(text)": "One line, no extra spacing.",
            "rule()": "A horizontal rule.",
            "banner(title)": "A boxed title block.",
            "header(title)": "A title with a rule under it.",
            "input": "Read one typed line. NEEDS the interactive Terminal — see form.ask()."
        },
        example: "terminal.banner('SCAN')\nterminal.line('starting...')"
    },
    ui: {
        description: "The UI toolkit gathered under one name. Each member is itself a module.",
        methods: {
            "progress / table / status / form / menu": "The same modules as their bare names.",
            "notify(text[, level])": "The notify send helper."
        },
        example: "ui.table.render([{'a': 1}])"
    },
    database: {
        description: "Database Viewer — INTERFACE ONLY. Every member raises NotImplemented.",
        methods: {
            "query(sql)": "Not built yet (raises).",
            "tables()": "Not built yet (raises).",
            "get(table, id)": "Not built yet (raises)."
        },
        example: "# nothing here runs yet - the seam exists so the import resolves"
    },
    missions: {
        description: "Mission Board — INTERFACE ONLY. Every member raises NotImplemented.",
        methods: {
            "list()": "Not built yet (raises).",
            "current()": "Not built yet (raises).",
            "accept(id)": "Not built yet (raises).",
            "complete(id)": "Not built yet (raises)."
        },
        example: "# nothing here runs yet - the seam exists so the import resolves"
    },
    json: {
        description: "JSON helpers for persisting structured state.",
        methods: {
            "parse(text)": "Parse JSON text to a value (alias: loads).",
            "stringify(value[, indent])": "Serialise a value (alias: dumps).",
            "load(path)": "Read + parse a JSON file.",
            "save(path, value)": "Serialise + write a JSON file.",
            "loads(text)": "Alias of parse().",
            "dumps(value[, indent])": "Alias of stringify()."
        },
        example: "json.save('/projects/data/state.json', {'runs': 1})"
    }
};
