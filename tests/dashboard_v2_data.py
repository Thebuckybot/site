"""Gevulde toestanden voor test_dashboard_v2.py: het Server Center en het
Security Center met echte vormen, zodat elke pagina gevuld wordt gemeten en niet
alleen leeg. Server-vormen uit test_server_tools_fase1/2 en test_bot_profiel;
het register is een uitsnede (vijf modules) van
backend/registries/security_registry_v2.as_dict() van 3-11-2026. Geen echte
servers, gebruikers of geheimen: alle ids zijn verzonnen."""
import json

NU = "2026-11-03T10:41:00Z"


REG = json.loads('{"modules": [{"key": "anti_nuke", "label": "Anti Nuke", "category": "structure", "status": "active", "trigger": "threshold", "events": ["channel_delete", "channel_create", "channel_update", "role_delete", "role_create", "role_update", "webhook_create", "member_ban", "member_kick", "emoji_delete", "sticker_delete", "integration_create"], "threshold_events": ["channel_delete", "channel_create", "channel_update", "role_delete", "role_create", "role_update", "webhook_create", "member_ban", "member_kick", "emoji_delete", "sticker_delete", "integration_create"], "scope": "user", "description": "Umbrella structural protection: counts destructive actions (channel/role/webhook/ban/kick/emoji/sticker/integration) per user; a more specific mass_* module takes precedence when enabled."}, {"key": "anti_raid", "label": "Anti Raid", "category": "members", "status": "active", "trigger": "threshold", "events": ["member_join"], "threshold_events": ["member_join"], "scope": "guild", "description": "Counts joins guild-wide; the limit auto-scales with member count when scaling is enabled on the threshold."}, {"key": "anti_mention_spam", "label": "Anti Mention Spam", "category": "messages", "status": "active", "trigger": "specialized", "events": ["message"], "threshold_events": ["mention"], "scope": "user", "field_labels": {"limit_count": "Mentions in ONE message (>= fires)", "window_seconds": "Re-alert cooldown after a detection (seconds)", "burst_limit": "(unused by this module)", "burst_window_seconds": "(unused by this module)"}, "description": "Fires when a single message contains at least `limit_count` mentions (users+roles+@everyone). `window_seconds` is NOT a counting window - it is the per-user cooldown before the same user can trigger another detection."}, {"key": "anti_links", "label": "Anti Links", "category": "messages", "status": "active", "trigger": "fixed", "events": ["message"], "threshold_events": [], "cooldown_seconds": 8, "description": "Fires on the FIRST message containing a link/invite; no threshold applies. Repeats from the same user+channel are deduplicated for the fixed cooldown."}, {"key": "anti_bots", "label": "Anti Bots", "category": "members", "status": "active", "trigger": "fixed", "events": ["member_join"], "threshold_events": [], "cooldown_seconds": 60, "description": "Fires when a non-whitelisted bot account joins; no threshold applies. Deduplicated per joined bot for the fixed cooldown. (Whitelist a bot via Trust with type \'bot\'/\'application\'.)"}], "events": ["channel_create", "channel_delete", "channel_update", "emoji_delete", "guild_update", "integration_create", "invite_create", "member_ban", "member_join", "member_kick", "member_unban", "mention", "message", "role_create", "role_delete", "role_update", "sticker_delete", "thread_create", "thread_delete", "webhook_create"], "stages": ["ban", "channel_lockdown", "delete_messages", "dm_target", "emergency_mode", "ignore", "kick", "log", "nickname_reset", "notify_staff", "quarantine", "remove_dangerous_permissions", "remove_dangerous_roles", "remove_roles", "remove_webhooks", "server_lockdown", "snapshot_rollback", "softban", "timeout", "warn"], "structural_only_stages": ["snapshot_rollback"], "structural_module_categories": ["structure"], "modes": ["both", "hard", "normal"], "on_failure": ["abort", "continue"], "stage_meta": {"nickname_reset": {"delay": true, "duration": false, "max_only_when_empty": false}, "remove_webhooks": {"delay": true, "duration": false, "max_only_when_empty": false}, "quarantine": {"delay": true, "duration": true, "max_only_when_empty": false}, "log": {"delay": true, "duration": false, "max_only_when_empty": false}, "delete_messages": {"delay": true, "duration": false, "max_only_when_empty": false}, "server_lockdown": {"delay": true, "duration": true, "max_only_when_empty": false}, "warn": {"delay": true, "duration": false, "max_only_when_empty": false}, "remove_dangerous_permissions": {"delay": true, "duration": false, "max_only_when_empty": false}, "dm_target": {"delay": true, "duration": false, "max_only_when_empty": false}, "emergency_mode": {"delay": true, "duration": true, "max_only_when_empty": false}, "channel_lockdown": {"delay": true, "duration": true, "max_only_when_empty": false}, "kick": {"delay": true, "duration": false, "max_only_when_empty": false}, "ignore": {"delay": true, "duration": false, "max_only_when_empty": false}, "remove_roles": {"delay": true, "duration": true, "max_only_when_empty": false}, "softban": {"delay": true, "duration": false, "max_only_when_empty": false}, "notify_staff": {"delay": true, "duration": false, "max_only_when_empty": false}, "ban": {"delay": true, "duration": false, "max_only_when_empty": false}, "timeout": {"delay": true, "duration": true, "max_only_when_empty": true}, "snapshot_rollback": {"delay": true, "duration": false, "max_only_when_empty": false}, "remove_dangerous_roles": {"delay": true, "duration": false, "max_only_when_empty": false}}, "duration_stages": ["channel_lockdown", "emergency_mode", "quarantine", "remove_roles", "server_lockdown", "timeout"], "antibot_targets": ["added_bot", "responsible_actor"], "antibot_target_actions": {"added_bot": ["kick", "ban"], "responsible_actor": ["timeout", "quarantine", "kick", "ban", "remove_roles", "remove_dangerous_roles", "remove_dangerous_permissions"]}, "antibot_targetable_stages": ["ban", "kick", "quarantine", "remove_dangerous_permissions", "remove_dangerous_roles", "remove_roles", "timeout"], "antibot_legacy_default_target": "added_bot", "recovery": {"schema_version": 3, "capability_version": 1, "restore_modes": ["safe_repair", "full_restore"], "suitabilities": ["baseline", "scheduled", "manual", "incident", "legacy", "invalid", "unsupported"], "usable_suitabilities": ["baseline", "scheduled", "manual"], "job_statuses": ["planned", "previewed", "queued", "running", "partial", "succeeded", "failed", "stale", "cancelled"], "captured": ["guild security settings", "roles (non-managed) + hierarchy/position", "categories", "text channels", "announcement channels", "voice channels", "stage channels", "forum channels (+ tags)", "media channels", "permission overwrites"], "not_captured": ["messages / history", "members", "attachments / files", "webhooks (tokens)", "emojis", "stickers", "integrations", "bot / application secrets", "audit-log history"], "notes": ["A snapshot is a structural / security recovery baseline, NOT a full server backup.", "Recreated Discord resources receive NEW ids (old->new ids are reported).", "Safe Repair never deletes live resources that are merely absent from the snapshot.", "Full Restore may delete eligible extras after Preview + explicit destructive confirmation; managed/protected/ambiguous resources are never deleted.", "Managed (integration/bot) roles and channels cannot be recreated or deleted by a bot.", "Announcement/stage/forum/media channels require the server\'s COMMUNITY feature; if absent, recovery reports them blocked (never downgraded)."]}, "scopes": ["guild", "role", "user"], "trust_types": ["application", "bot", "group", "role", "user"], "ignore_target_types": ["bot", "category", "channel", "role", "thread", "user"], "bounds": {"limit": [1, 1000], "window": [1, 86400]}, "retention": {"default": 14, "options": [14, 30, 90, 180, 365]}}')


def _ok(r, data):
    r.fulfill(status=200, content_type="application/json", body=json.dumps({"ok": True, "data": data}))


def data_security(gid):
    mods = []
    for i, m in enumerate(REG["modules"]):
        mods.append({**m, "enabled": i % 4 != 3})
    thresholds = []
    for m in REG["modules"][:8]:
        for ev in (m.get("threshold_events") or [])[:2]:
            thresholds.append({"id": len(thresholds) + 1, "event_type": ev, "scope": m.get("scope", "user"), "mode": "normal",
                               "limit_count": 5, "window_seconds": 10, "burst_limit": 0, "burst_window_seconds": 0,
                               "dynamic_scale": False, "split": False, "role_id": None})
    stages = [{"type": "delete_message", "params": {}, "delay": 0, "on_failure": "continue"},
              {"type": "timeout", "params": {}, "duration": 600, "delay": 0, "on_failure": "continue"}]
    chains = [{"id": i + 1, "trigger_key": m["key"], "mode": "normal", "name": f"{m['label']} default", "is_system": True,
               "stages": stages} for i, m in enumerate(REG["modules"][:5])]
    incidents = [{"id": 900 + i, "created_at": NU, "severity": s, "module_key": k, "event_type": e, "actor_id": "481516234200000001",
                  "attribution_confidence": "high", "details": {"count": 12}}
                 for i, (s, k, e) in enumerate([(4, "anti_mention", "mass_mention"), (3, "anti_links", "link_spam"),
                                                (5, "anti_raid", "join_wave"), (2, "anti_nuke", "role_update")])]
    audit = [{"id": 1, "created_at": NU, "action": "module_toggle", "module_key": "anti_links", "source": "dashboard",
              "target_id": "anti_links", "result": "ok"},
             {"id": 2, "created_at": NU, "action": "threshold_update", "module_key": "anti_spam", "source": "dashboard",
              "target_id": "message_send", "result": "ok"}]
    return {
        "/overview": {"security_score": 82, "grade": "B", "mode": "normal", "modules_enabled": 18, "modules_total": 24,
                      "incidents_today": 3, "quarantined": 1, "risk_level": 12},
        "/modules": mods,
        "/registry": REG,
        "/protection": {"admin_immunity": True, "owner_only_immunity": False,
                        "trusted_roles": [{"id": 1, "ref_id": "1022334455667788990"}], "trusted_users": []},
        "/ignore": [{"id": 1, "module_key": REG["modules"][0]["key"], "target_type": "role", "ref_id": "1022334455667788990"}],
        "/thresholds": thresholds,
        "/punishments": chains,
        "/incidents": {"items": incidents, "total": 4, "page": 0, "per_page": 25},
        "/audit": {"items": audit, "total": 2},
        "/analytics": {"incidents_today": 3, "incidents_week": 17, "quarantined_active": 1, "risk_score": 12,
                       "top_modules": [{"module": "anti_mention", "count": 7}, {"module": "anti_links", "count": 5},
                                       {"module": "anti_raid", "count": 3}]},
        "/analytics/timeline": {"points": [{"date": f"2026-10-{d:02d}", "count": (d * 7) % 5} for d in range(21, 32)]},
        "/health": {"score": 96, "grade": "A", "checks": [{"key": "anti_nuke", "ok": True, "severity": "high", "message": "Anti-nuke is on"},
                                                          {"key": "perm", "ok": False, "severity": "medium",
                                                           "message": "Bucky is missing Manage Webhooks"}],
                    "recommendations": ["Give Bucky Manage Webhooks so webhook spam can be stopped."]},
        "/emergency": {"emergency_mode": False, "raid_mode": False, "server_locked": False, "can_edit": True},
        "/quarantine": {"items": [{"id": 5, "user_id": "481516234200000001", "reason": "Join wave", "status": "active",
                                   "quarantined_at": NU, "expires_at": None}], "total": 1, "per_page": 10},
        "/quarantine/external": [],
    }


def stub_security(page, gid):
    d = data_security(gid)

    def route(r):
        pad = r.request.url.split(f"/api/security/{gid}", 1)[-1].split("?")[0]
        if r.request.method != "GET":
            return _ok(r, {})
        if pad in d:
            return _ok(r, d[pad])
        r.fallback()
    page.route(f"**/api/security/{gid}/**", route)


ROLLEN = [{"id": str(100000000000000000 + i), "name": f"role-{i}", "color": [3447003, 15158332, 3066993, 0][i % 4],
           "position": i, "allowed": i % 7 != 0, "reason": None if i % 7 else "is at or above Bucky's highest role",
           "reason_code": None if i % 7 else "too_high"} for i in range(1, 351)]
KANALEN = [{"id": "900000000000000001", "name": "verify", "type": 0}, {"id": "900000000000000002", "name": "general", "type": 0}]




def data_server():
    types = [{"key": k, "label": l, "default_label": l, "description": d, "prefix": k, "enabled": e, "position": i,
              "welcome_text": ""}
             for i, (k, l, d, e) in enumerate([("support", "Support", "General help", True),
                                               ("bug", "Bug Report", "Something broke", True),
                                               ("partner", "Partnership", "Work together", False)])]
    paneel = {"id": 4, "name": "Entry", "enabled": True, "channel_id": "900000000000000001", "message_id": None,
              "use_v2": True, "title": "Welcome", "body": "Press the button to get in.", "button_label": "Verify now",
              "button_emoji": "", "button_style": "success", "accent": 5793266, "add_role_ids": [ROLLEN[0]["id"]],
              "remove_role_ids": [], "channel_ids": [], "image_url": ""}
    return {
        "/tickets": {"settings": {"enabled": True, "category_id": None, "support_role_id": None, "log_channel_id": None,
                                  "transcript_channel_id": None, "panel_channel_id": None, "panel_message_id": None,
                                  "max_open_tickets": 3, "close_delay": 10},
                     "types": types, "channels": KANALEN, "roles": ROLLEN[:5], "open": [], "v2": True, "forms": True,
                     "welcome_placeholders": ["user", "server", "type"], "max_welcome_text": 1000},
        "/commands": {"cogs": [{"name": n, "cogs": [{"name": n.lower(), "disabled": False, "channels": []}], "disabled": n == "Games",
                                "channels": [], "commands": [{"name": c, "disabled": c == "rob", "channels": [], "protected": False}
                                                             for c in cmds]}
                               for n, cmds in (("Currency", ["daily", "balance", "rob", "pay"]), ("Games", ["wordle", "trivia"]),
                                               ("Moderation", ["ban", "kick", "warn"]))],
                      "channels": KANALEN, "bulk": True},
        "/autorole": {"enabled": True, "role_ids": [ROLLEN[1]["id"]], "include_bots": False, "roles": ROLLEN,
                      "bot_can_manage_roles": True, "can_manage_roles": True, "limits": {"max_roles": 5}},
        "/verify": {"panels": [paneel], "roles": ROLLEN, "panel_channels": KANALEN[:1], "access_channels": KANALEN,
                    "bot_can_manage_roles": True, "can_manage_channels": True, "can_manage_roles": True,
                    "image_hosts": ["api.buckybot.app"],
                    "limits": {"max_panels": 5, "max_add": 5, "max_remove": 5, "max_channels": 10, "max_title": 100,
                               "max_body": 1000, "max_button_label": 80}},
        "/applications": {"forms": [{"id": 1, "key": "staff", "title": "Staff application", "description": "Join the team",
                                     "enabled": True, "questions": [
                                         {"id": 1, "label": "How old are you?", "description": "", "input_type": "short", "required": True, "options": []},
                                         {"id": 2, "label": "Why do you want to join?", "description": "A few sentences", "input_type": "paragraph", "required": True, "options": []}]},
                                    {"id": 2, "key": "partner", "title": "Partner form", "description": "", "enabled": False, "questions": []}],
                          "limits": {"max_forms": 5, "max_questions": 5}},
        "/applications/submissions": {"items": [{"id": 11, "form_key": "staff", "user_id": "481516234200000001", "status": "pending",
                                                 "created_at": NU, "answers": [{"q": "How old are you?", "a": "19"},
                                                                               {"q": "Why do you want to join?", "a": "I help out a lot already."}]}]},
        "/bot-profile": {"bot": {"id": "907664862493167680", "username": "bucky", "name": "Bucky.", "avatar_url": None,
                                 "bio": "The global About me.", "banner_url": None},
                         "server": {"nick": "Bucky Jr", "avatar_url": None, "bio": "Here to help in this server.",
                                    "bio_known": True, "banner_url": None},
                         "can_change_nickname": True,
                         "limits": {"max_nick": 32, "max_bio": 190, "max_upload_bytes": 2097152, "changes_per_window": 20,
                                    "window_seconds": 300, "banner_min": [300, 120],
                                    "banner_changes": "twice in about 10 to 15 minutes"},
                         "rate_limit": None},
    }


def stub_server(page, gid):
    d = data_server()

    def route(r):
        pad = r.request.url.split(f"/api/server/{gid}", 1)[-1].split("?")[0]
        if r.request.method == "GET" and pad in d:
            return _ok(r, d[pad])
        r.fallback()
    page.route(f"**/api/server/{gid}/**", route)
