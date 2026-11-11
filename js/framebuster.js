/**
 * Geen iframe (review A8, 11-11-2026). De kaarteditor is een bedieningspagina: in een vreemd frame kan iemand je laten klikken op
 * iets wat je niet ziet. `frame-ancestors` werkt niet in een <meta>-CSP en GitHub Pages laat ons geen headers zetten, dus deze
 * kleine, klassieke (blokkerende) script in de <head>: zit de pagina in een frame, dan eerst proberen het bovenste venster naar
 * deze pagina te sturen, en lukt dat niet (het frame mag het niet), dan de pagina leegmaken en niets laden.
 * Geen inline script: de CSP laat alleen 'self' toe.
 */
(function () {
    "use strict";
    var erin = false;
    try { erin = window.top !== window.self; } catch (_e) { erin = true; }
    if (!erin) return;
    try { window.top.location.replace(window.self.location.href); } catch (_e) { /* niet toegestaan */ }
    try { window.stop(); } catch (_e) { /* geen stop */ }
    try { document.documentElement.replaceChildren(); } catch (_e) { /* niets meer te doen */ }
})();
