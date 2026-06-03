/**
 * bucky.leaderboards — the Grid rankings, read-only (Phase 4.5, §13).
 *
 * Reads the leaderboard projections the backend already publishes for
 * bucky://leaderboards, captured as a snapshot section at script start. The
 * known kinds mirror the gateway: `richest | level | org-reputation |
 * most-leaked`. Strictly read-only — rankings are computed by the backend.
 *
 *   kinds()              the available leaderboard kinds
 *   top(kind[, limit])   the ranked rows for a kind (optionally capped)
 *   rank(kind)           the calling operator's 1-based rank, or None
 *   organizations()      the organisation leaderboard (reputation, then members)
 *
 * Rows are tolerated in several shapes ({ user_id, handle, value, rank }) so the
 * module survives backend shape changes; degrades to empty lists when offline.
 */
import { mod, def, asList } from "./kit.js";
import { tableLines, display } from "./ui.js";

export function createLeaderboardsModule(ctx) {
    const board = () => (ctx.snapshot && ctx.snapshot.leaderboards) || {};
    const kindsMap = () => (board().kinds && typeof board().kinds === "object" ? board().kinds : {});
    const orgsRoot = () => (ctx.snapshot && ctx.snapshot.organizations) || {};
    const selfId = () => {
        const p = (ctx.snapshot && ctx.snapshot.profile) || {};
        return String(p.user_id || p.id || (ctx.user && ctx.user.id) || "");
    };

    function kinds() {
        ctx.caps.require("leaderboards", "leaderboards.kinds");
        return Object.keys(kindsMap());
    }
    function top(kind, limit) {
        ctx.caps.require("leaderboards", "leaderboards.top");
        const rows = asList(kindsMap()[String(kind == null ? "" : kind)]);
        return typeof limit === "number" && limit > 0 ? rows.slice(0, limit) : rows.slice();
    }
    function rank(kind) {
        ctx.caps.require("leaderboards", "leaderboards.rank");
        const id = selfId();
        if (!id) return null;
        const rows = asList(kindsMap()[String(kind == null ? "" : kind)]);
        for (let i = 0; i < rows.length; i++) {
            const r = rows[i];
            const rid = String((r && (r.user_id || r.id)) || "");
            if (rid && rid === id) return typeof r.rank === "number" ? r.rank : i + 1;
        }
        return null;
    }
    function organizations() {
        ctx.caps.require("leaderboards", "leaderboards.organizations");
        // Prefer the published org-reputation board; otherwise rank the org
        // registry by reputation, then member count.
        const published = asList(kindsMap()["org-reputation"]);
        if (published.length) return published.slice();
        const rankBy = (o) => (typeof o.reputation === "number" ? o.reputation : (typeof o.members === "number" ? o.members : 0));
        return asList(orgsRoot().list).slice().sort((a, b) => rankBy(b) - rankBy(a));
    }

    // ----- readable rendering layer (Phase 4.5B leaderboard UX) --------------
    // Leaderboards previously surfaced as raw JSON blobs. These produce aligned,
    // human-readable tables instead. `format`/`table` RETURN the text (no print,
    // for capture/reporting); `render`/`pretty` PRINT it live and return a
    // display token, so `print(leaderboards.render())` never double-renders
    // (see ui.js display() — same BUG 3 contract).
    const COLS = {
        richest: ["rank", "operator", "level", "org"],
        level: ["rank", "operator", "level"],
        "org-reputation": ["rank", "organization", "reputation", "members"],
        "most-leaked": ["rank", "operator", "exposures"]
    };
    function boardRows(kind) {
        const k = String(kind == null ? "richest" : kind);
        return asList(kindsMap()[k]).map((r) => {
            r = r || {};
            const org = r.organization || {};
            return {
                rank: r.rank != null ? r.rank : "",
                operator: r.handle || r.user_id || r.id || "",
                org: org.name || "",
                organization: r.name || org.name || "",
                level: r.level != null ? r.level : "",
                reputation: r.reputation != null ? r.reputation : (r.score_value != null ? r.score_value : ""),
                members: r.members != null ? r.members : "",
                exposures: r.score_label === "exposures" ? r.score_value : (r.exposures != null ? r.exposures : ""),
                score: r.score_value != null ? r.score_value : ""
            };
        });
    }
    function formatBoard(kind, limit) {
        ctx.caps.require("leaderboards", "leaderboards.format");
        const k = String(kind == null ? "richest" : kind);
        let rows = boardRows(k);
        if (typeof limit === "number" && limit > 0) rows = rows.slice(0, limit);
        const title = "LEADERBOARD \u2014 " + k;
        if (!rows.length) return title + "\n  (no data \u2014 leaderboard empty or backend offline)";
        const cols = COLS[k] || ["rank", "operator", "score"];
        return title + "\n" + tableLines(rows, cols).join("\n");
    }
    const renderBoard = (args, kwargs, interp) => {
        const text = formatBoard(args && args[0], args && args[1]);
        text.split("\n").forEach((l) => interp.print(l));
        return display(text);
    };

    return mod("bucky.leaderboards", {
        kinds: def(kinds),
        top: def(top),
        rank: def(rank),
        organizations: def(organizations),
        // Convenience accessors for the named backend kinds.
        richest: def((limit) => top("richest", limit)),
        levels: def((limit) => top("level", limit)),
        level: def((limit) => top("level", limit)),
        reputation: def((limit) => top("org-reputation", limit)),
        mostLeaked: def((limit) => top("most-leaked", limit)),
        most_leaked: def((limit) => top("most-leaked", limit)),
        // Readable rendering (Phase 4.5B). render()/pretty() print; table()/format() return.
        format: (args) => formatBoard(args && args[0], args && args[1]),
        table: (args) => formatBoard(args && args[0], args && args[1]),
        render: renderBoard,
        pretty: renderBoard
    });
}
