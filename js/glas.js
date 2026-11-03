// Dashboard v2: de lichte vervorming van het glas (zijpaneel, balk, venster).
//
// ALLEEN CHROMIUM. Alleen Chromium tekent `backdrop-filter: url(#dv2-vervorm)`;
// Safari en Firefox accepteren de waarde soms in CSS.supports maar tekenen dan
// niets, dus de test is op de engine en niet op @supports. Zonder deze klasse is
// het gewoon blurglas (security.css), en zonder backdrop-filter of met "minder
// transparantie" een effen vlak. Met "minder beweging" ook geen vervorming.
//
// Een klassiek script (geen module) dat in de <head> draait, zodat de klasse er
// staat voor de eerste keer tekenen: geen flits van blur naar vervorming.
(function () {
  try {
    var merken = (navigator.userAgentData && navigator.userAgentData.brands) || [];
    var chromium = merken.some(function (m) { return /Chromium/.test(m.brand); });
    var rustig = window.matchMedia("(prefers-reduced-transparency: reduce)").matches
      || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (chromium && !rustig) document.documentElement.classList.add("glas-vervorming");
  } catch (_) { /* geen vervorming: het blurglas blijft */ }
})();
