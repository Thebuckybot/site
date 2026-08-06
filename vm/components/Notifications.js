/**
 * Notifications component.
 *
 * The toast stack. The runtime re-renders only the items inside
 * `.vm-notifications` via updateNotifications — a targeted update.
 *
 * BEIDE VELDEN WORDEN GEËSCAPED, EN DAT IS GEEN NETTIGHEID (bevinding G-1).
 * Dit was de enige plek in de hele VM waar inhoud ongeëscaped in `innerHTML`
 * landde, en hij is bereikbaar met inhoud van een ANDERE SPELER:
 *
 *   MailApp.js  ->  notify("Attachment saved", result.path)
 *   result.path ->  /mail/attachments/<bestandsnaam van de afzender>
 *
 * Die naam kwam ongefilterd uit `mail_service.send_mail`. Een bijlage die
 * `<img src=x onerror=...>` heette, draaide dus code in de browser van de
 * ontvanger — op buckybot.app, het origin waar `localStorage.api_token` staat.
 *
 * Deze component werd geschreven vóór de mail bestond, toen er nog niets in
 * stond wat van iemand anders kwam. Dat is geen excuus maar wel de reden dat
 * `xss_surfaces.mjs` er nu een test op zet in plaats van een comment.
 *
 * De bijlagenaam wordt sinds dezelfde ronde óók aan de bron schoongemaakt
 * (`mailAttachmentService.sanitizeName` en `mail_service._safe_filename`). Drie
 * lagen voor één keten is met opzet: dit is de enige plek waar speler A iets in
 * de browser van speler B krijgt.
 */
import { escapeHtml } from "../core/util.js";

/** Render the toast items (contents of `.vm-notifications`). */
export function renderNotificationItems(runtime) {
    return runtime.notifications.map((item) => `
        <div class="vm-notification">
            <strong>${escapeHtml(item.title)}</strong>
            <span>${escapeHtml(item.message)}</span>
        </div>
    `).join("");
}

export function renderNotifications(runtime) {
    return `
        <div class="vm-notifications" aria-live="polite">
            ${renderNotificationItems(runtime)}
        </div>
    `;
}
