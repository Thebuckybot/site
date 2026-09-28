// Het hamburgermenu van de publieke pagina's.
//
// Dit stond als inline <script> onderaan elke pagina, in drie net iets andere
// versies. De Content Security Policy van de site staat geen inline scripts toe
// (script-src 'self'), dus het staat nu hier, één keer.
//
// Een gewoon (klassiek) script en geen module, en onderaan de <body> geladen:
// dan draait het op precies hetzelfde moment als het inline blok deed, met
// .hamburger en #nav-menu al in de DOM.
//
// Per pagina één variatie, via een attribuut op de script-tag:
//   data-close-on-link  -> een klik op een link in het open menu klapt het
//                          dicht (index.html en dashboard.html deden dat al).
(function () {
  var script = document.currentScript;
  var sluitBijLink = !!(script && script.hasAttribute("data-close-on-link"));
  var hb = document.querySelector(".hamburger");
  var menu = document.getElementById("nav-menu");
  if (!hb || !menu) return;

  hb.addEventListener("click", function () {
    var open = hb.getAttribute("aria-expanded") === "true";
    hb.setAttribute("aria-expanded", String(!open));
    hb.classList.toggle("open");
    menu.classList.toggle("open");
  });

  if (sluitBijLink) {
    menu.addEventListener("click", function (e) {
      if (e.target.closest("a")) {
        hb.classList.remove("open");
        menu.classList.remove("open");
        hb.setAttribute("aria-expanded", "false");
      }
    });
  }
})();
