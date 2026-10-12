/*
 * buckybot.app, voorpagina v2 ("Clean & Epic"). Alleen v2/index.html laadt dit.
 *
 * Wat er van de rest van de site gebruikt wordt, is infrastructuur en geen v1:
 * js/features.js (de aan/uit-vlaggen uit +ownerconfig, voor elk `data-feature`)
 * en js/config.js (het adres van de API). Geen van beide wordt hier aangepast.
 *
 * De pagina werkt zonder dit bestand: alle tekst staat in de HTML en is
 * zichtbaar. Dit voegt alleen toe: het menu op een telefoon, de echte cijfers,
 * en (als de bezoeker beweging toestaat) wat zachte beweging.
 */
import "../../js/features.js";

/* ---- B1. Het menu ---------------------------------------------------------- */
function nav() {
    const kop = document.querySelector("[data-nav]");
    if (!kop) return;
    const knop = kop.querySelector(".nav-toggle");
    const menu = kop.querySelector("#nav-menu");

    const zet = (open) => {
        kop.classList.toggle("is-open", open);
        knop.setAttribute("aria-expanded", String(open));
    };
    knop.addEventListener("click", () => zet(!kop.classList.contains("is-open")));
    // Een link in het menu kiezen sluit het: het doel staat meestal op deze pagina.
    menu.addEventListener("click", (e) => {
        if (e.target.closest("a")) zet(false);
    });
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && kop.classList.contains("is-open")) {
            zet(false);
            knop.focus();
        }
    });
    const breed = window.matchMedia("(min-width: 1080px)");
    breed.addEventListener("change", (e) => { if (e.matches) zet(false); });

    const gescrold = () => kop.classList.toggle("is-scrolled", window.scrollY > 8);
    gescrold();
    window.addEventListener("scroll", gescrold, { passive: true });
}

nav();
