// Doorsturen van een oude losse pagina (soc.html, rule-builder.html) naar zijn
// sectie in het Security Center, met de querystring (guild_id) erbij.
//
// Stond als inline <script> in de <head> van die pagina's. De Content Security
// Policy staat geen inline scripts toe, dus het staat nu hier. Een klassiek,
// synchroon script in de <head>: het stuurt door op hetzelfde moment als
// voorheen, nog voordat de body getekend is. De <meta http-equiv="refresh">
// in de pagina blijft de terugval zonder JavaScript.
//
// De sectie staat op de script-tag: <script src="js/legacy-redirect.js" data-section="soc">.
(function () {
  var script = document.currentScript;
  var sectie = script && script.getAttribute("data-section");
  if (!sectie || !/^[a-z]+$/.test(sectie)) return;
  var qs = window.location.search || "";
  window.location.replace("security.html" + qs + "#" + sectie);
})();
