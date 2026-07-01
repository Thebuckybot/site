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
};

export function moduleDesc(key) { return MODULE_DESC[key] || "A security protection module."; }
export function settingDesc(key) { return SETTING_DESC[key] || ""; }
