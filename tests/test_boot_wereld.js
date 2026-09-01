/**
 * De opening in de kustlijn, zonder browser en zonder te sturen.
 *
 * WAAROM DIT ER NIET ALS SCHERMTEST IS
 * De eerste opzet reed de boot met pijltjestoetsen het eiland op en las de
 * kleur naast de romp uit. Dat werkte niet: sturen is te grof om een gat van
 * veertig eenheden mee te raken, dus dezelfde toetsaanslagen kwamen de ene keer
 * wel en de andere keer niet bij de kust - en een test die met en zonder de fix
 * hetzelfde antwoord geeft, bewijst niets. Zie de sessienotitie.
 *
 * De regel zelf is een som van twee vergelijkingen. Die hoort ook zo getest te
 * worden: exact, op de rand, en in een halve seconde.
 *
 * DRAAIEN:  node tests/test_boot_wereld.js
 */

import { opSteiger } from "../js/minigames/boat.js";

const STEIGER = { x: 1840, y: 900, w: 180, h: 44 };

let mislukt = 0;

function eis(beschrijving, gemeten, verwacht) {
    if (gemeten === verwacht) {
        console.log(`  OK   ${beschrijving}`);
    } else {
        console.log(`  FOUT ${beschrijving} (verwacht ${verwacht}, kreeg ${gemeten})`);
        mislukt++;
    }
}

console.log("De opening in de kust is precies de plank die je ziet\n");

// De plank loopt van x 1750 tot 1930 en van y 878 tot 922.
eis("het midden van de steiger is een opening",
    opSteiger(1840, 900, STEIGER), true);
eis("net binnen de linkerrand is een opening",
    opSteiger(1755, 900, STEIGER), true);
eis("net binnen de rechterrand is een opening",
    opSteiger(1925, 900, STEIGER), true);
eis("net binnen de bovenrand is een opening",
    opSteiger(1840, 880, STEIGER), true);

// EN DIT IS DE FOUT DIE ER ZAT. Al deze punten liggen NAAST de plank maar
// binnen de oude, twee keer te grote opening. Met `s.w` en `s.h` gaven ze
// allemaal `true` en kon je er het gras op varen.
eis("een halve plank naar links is GEEN opening meer",
    opSteiger(1700, 900, STEIGER), false);
eis("een halve plank naar rechts is GEEN opening meer",
    opSteiger(1980, 900, STEIGER), false);
eis("dertig eenheden onder de plank is GEEN opening meer",
    opSteiger(1840, 930, STEIGER), false);
eis("dertig eenheden boven de plank is GEEN opening meer",
    opSteiger(1840, 870, STEIGER), false);
eis("schuin naast de hoek van de plank is GEEN opening meer",
    opSteiger(1960, 935, STEIGER), false);

console.log(mislukt
    ? `\n${mislukt} controle(s) mislukt. Zie \`opSteiger\` in js/minigames/boat.js.`
    : "\nDe opening klopt met de plank, op alle vier de randen.");
process.exit(mislukt ? 1 : 0);
