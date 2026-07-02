// Single source of plain-language descriptions for every module and setting.
// The Discord Components V2 UI uses the same wording (parity) so the product
// reads identically everywhere and the user never needs external documentation.

export const MODULE_DESC = {
  anti_nuke: "Protects against mass deletion of channels, roles and permissions.",
  anti_raid: "Detects sudden waves of member joins and raises the protection posture.",
  anti_spam: "Stops users from flooding channels with messages.",
  anti_mention_spam: "Blocks mass-mention and @everyone abuse in a single message.",
  anti_links: "Detects links, invites and scam URLs in messages.",
  anti_tokens: "Catches leaked bot tokens and webhook URLs posted in chat.",
  anti_webhooks: "Guards against unauthorized webhook creation and webhook spam.",
  anti_bots: "Flags unauthorized bots or apps being added to the server.",
  mass_channel_delete: "Triggers when many channels are deleted in a short window.",
  mass_channel_create: "Triggers when many channels are created in a short window.",
  mass_role_delete: "Triggers when many roles are deleted in a short window.",
  mass_role_create: "Triggers when many roles are created in a short window.",
  mass_permission_change: "Detects sweeping permission changes across roles or channels.",
  mass_emoji_delete: "Triggers when many emojis are deleted quickly.",
  mass_sticker_delete: "Triggers when many stickers are deleted quickly.",
  mass_ban: "Detects an unusually fast burst of bans.",
  mass_kick: "Detects an unusually fast burst of kicks.",
  dangerous_perm_escalation: "Flags a role being granted dangerous permissions like Administrator.",
  vanity_url_change: "Detects tampering with the server's vanity URL or identity.",
  integration_abuse: "Detects suspicious integration creation or abuse.",
};

export const SETTING_DESC = {
  mode: "Normal is forgiving; Hard triggers on the very first suspicious action.",
  threshold: "The maximum allowed actions within the time window before Security triggers.",
  window: "The time window, in seconds, over which actions are counted.",
  burst: "An optional tighter sub-window that catches sudden spikes.",
  punishment: "The ordered chain of actions Security takes when a module triggers.",
  protection_role: "Members with a trusted role are ignored by anti-nuke.",
  protected_user: "This user is ignored by anti-nuke.",
  admin_immunity: "When on, Administrators are treated as trusted. Turn off to defend against a compromised admin.",
  owner_only_immunity: "Strictest posture: only the server owner is immune, regardless of other trust.",
  quarantine: "Removes a caught member's roles, stores them safely, and applies a locked quarantine role.",
  quarantine_role: "The role applied to quarantined members; it denies chatting, reactions, voice and invites.",
  ignore: "Exempts specific channels, roles or users from a protection. Categories cover their channels; channels cover their threads.",
  emergency_mode: "Temporarily enables the highest protection level for the whole server.",
  server_lock: "Disables sending for @everyone until lifted. Fully reversible.",
  snapshot: "A saved picture of the server's channels and roles, used to roll back after an attack.",
  health: "An automatic score of how well the server is protected, with recommendations.",
  retention: "How long incidents, audit logs and analytics are kept before automatic cleanup.",
  alert_channel: "Where Security posts alerts (attacks caught, members quarantined). Use a staff-only channel. Set it so you actually see what Security does.",
  logging_channel: "Optional separate channel for detailed security logging. If unset, alerts and logs share the alert channel.",
  protection_role_setting: "A trusted staff role that anti-nuke ignores. Give it to people you trust with mass actions; leave attackers out of it.",
  trust: "Roles and users Security treats as trusted (immune). Keep this list tight — everyone on it can bypass protection.",
  snapshots_setting: "Automatic backups of your channels and roles. Security uses the newest one to rebuild structure after a nuke. Kept for the last few captures.",
  recovery: "Rebuilds channels and roles a nuke deleted, from the newest snapshot. It only re-creates what is missing — it never deletes your work.",
  emergency_enable: "Raises the whole server to the strictest posture. Use during an active attack. Internally: sets emergency + raid mode so detection is hair-trigger and punishments escalate. Reversible.",
  server_lock: "Disables sending for @everyone until you lift it. Use to freeze a raid instantly. Internally: removes Send Messages from @everyone and records the prior value so unlock restores it exactly.",
  lift_lockdown: "Restores @everyone messaging and clears emergency posture. Use once the threat is contained.",
  rollback_action: "Recreates channels and roles from the newest snapshot — for after a nuke. Only re-creates what is missing (never deletes). Detection ignores its own rebuild (self-action guard). Run AFTER containment, not during.",
  quarantine_repair: "Creates or fixes the quarantine role and its channel-deny overwrites. Use if the role is missing or its permissions were tampered with. Never runs during an active attack.",
  quarantine_perms: "The quarantine role denies: sending messages, threads, reactions, voice connect/speak, invites, TTS and application commands — everywhere.",
};

// Punishment-chain stage vocabulary — what each stage does, in plain language.
export const STAGE_DESC = {
  ignore: "Take no action (a no-op placeholder, useful while building a chain).",
  warn: "Record a warning against the offender.",
  log: "Write this action to the security log / audit history.",
  delete_messages: "Delete the offending messages (spam, links, tokens).",
  dm_target: "Send the offender a direct message explaining what happened.",
  notify_staff: "Post an alert to your staff alert channel.",
  remove_roles: "Remove all of the offender's removable roles.",
  remove_dangerous_roles: "Remove only roles that carry dangerous permissions.",
  remove_dangerous_permissions: "Strip dangerous permissions from the offender's roles.",
  quarantine: "Move the offender to the quarantine role (roles are vaulted and restored on release).",
  timeout: "Time the offender out for the configured duration.",
  nickname_reset: "Reset an abusive nickname.",
  remove_webhooks: "Delete webhooks involved in the abuse.",
  channel_lockdown: "Lock the affected channel (reversible).",
  server_lockdown: "Disable sending for @everyone server-wide (reversible).",
  snapshot_rollback: "Roll back channels/roles from the latest snapshot (nuke recovery).",
  emergency_mode: "Raise the server to emergency posture.",
  kick: "Kick the offender.",
  softban: "Ban then immediately unban to clear the offender's recent messages.",
  ban: "Ban the offender.",
};
export function stageDesc(key) { return STAGE_DESC[key] || "A punishment-chain stage."; }

export function moduleDesc(key) { return MODULE_DESC[key] || "A security protection module."; }
export function settingDesc(key) { return SETTING_DESC[key] || ""; }
