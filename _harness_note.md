Deze map bevat twee testpagina's die met een underscore beginnen:
`__harness.html` en `__profile_harness.html`.

GitHub Pages draait Jekyll, en Jekyll negeert álles wat met een underscore
begint - dus die twee gaven een 404 terwijl ze gewoon in de repo stonden. Het
lege bestand `.nojekyll` naast dit bestand zet Jekyll uit voor de hele site.
Dat is de door GitHub gedocumenteerde manier; hernoemen zou werken maar breekt
elke link die er al naar wijst.

Er verandert verder niets: deze site heeft geen build-stap en gebruikt geen
enkele Jekyll-functie.
