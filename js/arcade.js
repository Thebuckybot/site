import { API_URL } from "./config.js";
import { apiFetch } from "./dashboard.js";
import { BuckyVMRuntime } from "../vm/core/vmRuntime.js";

let buckyVM = null;

document.addEventListener("DOMContentLoaded", () => {

    const opening = document.getElementById("arcade-opening");
    const columns = document.querySelectorAll(".column");
    initArcadeScrollEffects();

    // ==============================
    // Random heights per column.
    // ==============================

    columns.forEach(column => {
        const topSegment = column.querySelector(".segment.top");
        const bottomSegment = column.querySelector(".segment.bottom");

        // random tussen 30% en 70%
        const topHeight = 30 + Math.random() * 40;

        topSegment.style.flexBasis = `${topHeight}%`;
        bottomSegment.style.flexBasis = `${100 - topHeight}%`;
    });

    // ==============================
    // De opening.
    // ==============================
    //
    // WAT HIER EERST MIS GING. Elke kolom kreeg `Math.random() * 1200` aan
    // vertraging en de fade begon op een vaste 3000ms. Twee gevolgen: de
    // luiken gingen in een willekeurige volgorde open, wat als schokkerig leest
    // en niet als een beweging, en een kolom die pech had met zijn worp was op
    // 3000ms nog bezig terwijl het scherm al begon te vervagen - dan zie je een
    // half opengeschoven luik verdwijnen.
    //
    // Nu loopt de opening VAN HET MIDDEN NAAR BUITEN met een vaste stap. Dat is
    // een richting in plaats van ruis, en het einde is uit te rekenen in plaats
    // van te hopen: de fade begint precies wanneer het laatste luik klaar is.

    const reduceerBeweging = window.matchMedia(
        "(prefers-reduced-motion: reduce)").matches;

    const STAP = 70;        // ms tussen twee kolommen
    const SCHUIF = 1500;    // ms dat een luik zelf onderweg is (zie arcade.css)
    const FADE = 500;

    if (reduceerBeweging) {
        // Geen filmische opening voor wie dat heeft uitgezet: meteen weg, en
        // geen 3,5 seconden naar een dicht scherm kijken.
        opening.remove();
    } else {
        const midden = (columns.length - 1) / 2;
        let laatste = 0;

        columns.forEach((column, i) => {
            const topSegment = column.querySelector(".segment.top");
            const bottomSegment = column.querySelector(".segment.bottom");
            const vertraging = Math.round(Math.abs(i - midden) * STAP);
            laatste = Math.max(laatste, vertraging);

            setTimeout(() => {
                topSegment.style.transform = "translateY(-120%)";
                bottomSegment.style.transform = "translateY(120%)";
            }, 600 + vertraging);
        });

        // Pas fade als het traagste luik echt uit beeld is.
        const klaar = 600 + laatste + SCHUIF;
        setTimeout(() => {
            opening.style.transition = `opacity ${FADE}ms ease`;
            opening.style.opacity = "0";
            setTimeout(() => opening.remove(), FADE);
        }, klaar);
    }


    // ==============================
    // Game logic.
    // ==============================

    loadProfile();
    hangRefreshOp();

    const headsBtn = document.getElementById("heads-btn");
    const tailsBtn = document.getElementById("tails-btn");

    if (headsBtn && tailsBtn) {
        headsBtn.addEventListener("click", () => playCoinflip("heads"));
        tailsBtn.addEventListener("click", () => playCoinflip("tails"));
    }

});

async function loadProfile() {
    let data;

    try {
        const res = await apiFetch(`${API_URL}/api/me`);
        data = await res.json();
    } catch (error) {
        console.error("Arcade profile load failed:", error);
        mountBuckyVM({
            username: "operator",
            avatarUrl: "https://cdn.discordapp.com/embed/avatars/0.png"
        });
        return;
    }

    if (!data.logged_in) {
        mountBuckyVM({
            username: "operator",
            avatarUrl: "https://cdn.discordapp.com/embed/avatars/0.png"
        });
        return;
    }

    const user = data.user;
    user.avatarUrl = getDiscordAvatar(user);
    // Phase 4.3 — propagate the localStorage API token into the VM. The site
    // uses `apiFetch` with `Authorization: Bearer <token>`; the VM's gateway
    // used to rely only on the cross-origin session cookie, which dropped in
    // third-party / cross-origin contexts and resulted in the "anonymous
    // visitor" identity-binding failure on bucky://profile.
    try {
        user.api_token = localStorage.getItem("api_token") || null;
    } catch (_e) {
        user.api_token = null;
    }

    document.getElementById("hero-username").innerText = user.username;
    document.getElementById("hero-avatar").src = user.avatarUrl;
    mountBuckyVM(user);

    await ververisStats();
}

// DE STATS APART, ZODAT DE REFRESH-KNOP ZE OPNIEUW KAN HALEN.
// Ze zaten in `loadProfile`, samen met het monteren van de VM. Dat betekende
// dat je je shards alleen kon bijwerken door de hele pagina te herladen - en
// dan start de VM opnieuw op en ben je kwijt waar je was.
//
// Geeft true terug als het gelukt is, zodat de knop iets kan zeggen.
async function ververisStats() {
    let arcadeData;
    try {
        const arcadeRes = await apiFetch(`${API_URL}/api/arcade/profile`);
        arcadeData = await arcadeRes.json();
    } catch (error) {
        console.error("Arcade stats load failed:", error);
        return false;
    }
    if (!arcadeData || typeof arcadeData.coins === "undefined") return false;

    // textContent, geen innerText/innerHTML: dit komt van de server.
    document.getElementById("coins").textContent = arcadeData.coins;
    document.getElementById("xp").textContent = arcadeData.xp;
    document.getElementById("level").textContent = arcadeData.level;
    document.getElementById("xp-progress").style.width = (arcadeData.xp % 100) + "%";
    return true;
}

// DE KNOP OP DE SPELERSKAART.
//
// Waarom er een status naast staat en niet alleen een draaiend icoon: een
// animatie zegt "er gebeurt iets", niet "het is gelukt". Wie de shards net
// heeft verdiend met de Wordle wil bevestigd zien dat ze binnen zijn, en een
// schermlezer moet dat ook horen - vandaar de aria-live ernaast.
function hangRefreshOp() {
    const knop = document.getElementById("hero-refresh");
    const status = document.getElementById("hero-refresh-status");
    if (!knop) return;

    let bezig = false;
    knop.addEventListener("click", async () => {
        if (bezig) return;
        bezig = true;
        knop.classList.add("is-busy");
        knop.disabled = true;
        if (status) status.textContent = "Refreshing...";

        const gelukt = await ververisStats();

        knop.classList.remove("is-busy");
        knop.disabled = false;
        bezig = false;
        if (status) {
            status.textContent = gelukt
                ? "Updated just now."
                : "Could not refresh. Try again in a moment.";
        }
    });
}

function mountBuckyVM(user) {
    const root = document.getElementById("bucky-vm-root");
    if (!root || buckyVM) return;

    buckyVM = new BuckyVMRuntime(root, user);
    buckyVM.start();
}

function getDiscordAvatar(user) {
    if (!user?.id || !user?.avatar) {
        return "https://cdn.discordapp.com/embed/avatars/0.png";
    }

    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`;
}

function initArcadeScrollEffects() {
    const heroBackground = document.querySelector(".hero-background");
    const heroLeft = document.querySelector(".hero-left");
    let ticking = false;

    // DE KAART VERHUIST NAAR <BODY> ZODRA HIJ VASTZET, en dat is de eigenlijke
    // reparatie van "de hero gaat onder de VM".
    //
    // WAAROM EEN HOGER GETAL NOOIT GENOEG WAS. De kaart is bij het vastzetten
    // `position: fixed` met `z-index: 78`, maar dat getal wordt opgelost binnen
    // de stapelcontext waar hij in hangt - en dat waren er VIER boven elkaar:
    //
    //     .player-hero-card   fixed, z-index 78
    //       .hero-left        z-index 6
    //       .hero-content     z-index 2
    //       .arcade-hero      z-index 100
    //       #arcade-world     position: relative + z-index 0   <-- klemt alles
    //
    // `#arcade-world` staat op 0, dus de hele arcade zit in een context van 0.
    // Wat je binnen die context ook op de hero zet, hij kan nooit boven iets
    // uitkomen dat buiten die context ligt. Dat is de reden dat de vorige twee
    // pogingen (78, daarna 100) niets veranderden: het getal was nooit het
    // probleem.
    //
    // Erger nog: `.hero-left` krijgt hieronder een inline `transform` bij het
    // scrollen, en een ouder met een transform wordt het CONTAINING BLOCK van
    // een `position: fixed` kind. Op dat moment is de kaart niet meer aan het
    // scherm vastgezet maar aan een element dat zelf wegschuift.
    //
    // Door hem bij het vastzetten naar `<body>` te verplaatsen heeft hij geen
    // enkele ouder meer die hem kan klemmen of verplaatsen. Er is dan niets
    // meer tussen hem en het scherm. Bij het losmaken gaat hij terug op zijn
    // eigen plek, want in de hero hoort hij gewoon in de indeling te staan.
    const kaart = document.querySelector(".player-hero-card");
    const anker = kaart ? document.createComment("player-hero-card") : null;
    if (kaart && anker) kaart.parentNode.insertBefore(anker, kaart);
    let verhuisd = false;

    // ALLEEN VERHUIZEN ALS HIJ OOK ECHT VASTGEZET WORDT. Onder 700px laat de
    // CSS hem bewust in de indeling staan (op een telefoon legde hij zich over
    // de kop eronder). Zou hij daar tóch naar <body> gaan, dan staat hij als
    // gewoon blok onderaan de pagina, onder de voettekst - precies het soort
    // fout dat een verhuizing zonder voorwaarde oplevert. Deze grens moet
    // gelijk blijven aan de media query in arcade.css.
    const magVastzetten = window.matchMedia("(min-width: 701px)");

    const zetVast = (vast) => {
        if (!kaart || !anker) return;
        vast = vast && magVastzetten.matches;
        if (vast === verhuisd) return;
        if (vast) {
            document.body.appendChild(kaart);
        } else if (anker.parentNode) {
            anker.parentNode.insertBefore(kaart, anker);
        }
        verhuisd = vast;
    };

    const update = () => {
        const scrollY = window.scrollY || 0;
        const vast = scrollY > 260;
        document.body.classList.toggle("arcade-profile-pinned", vast);
        zetVast(vast);

        if (heroBackground) {
            heroBackground.style.transform = `translate3d(0, ${scrollY * 0.12}px, 0) scale(${1 + Math.min(scrollY, 700) * 0.00008})`;
        }

        if (heroLeft && scrollY <= 260) {
            heroLeft.style.transform = `translate3d(0, ${scrollY * -0.035}px, 0)`;
        } else if (heroLeft) {
            heroLeft.style.transform = "";
        }

        ticking = false;
    };

    window.addEventListener("scroll", () => {
        if (ticking) return;
        ticking = true;
        window.requestAnimationFrame(update);
    }, { passive: true });

    // Draaien van een tablet wisselt de kant van die grens, dus opnieuw kijken.
    magVastzetten.addEventListener("change", update);

    update();
}


async function playCoinflip(choice) {
    const betInput = document.getElementById("bet");
    const resultEl = document.getElementById("result");
    const headsBtn = document.getElementById("heads-btn");
    const tailsBtn = document.getElementById("tails-btn");

    const bet = parseInt(betInput.value);

    // -------- BASIC VALIDATION --------
    if (isNaN(bet) || bet <= 0) {
        resultEl.innerText = "Invalid bet amount.";
        return;
    }

    // -------- UI LOCK --------
    headsBtn.disabled = true;
    tailsBtn.disabled = true;
    resultEl.innerText = "Flipping...";

    try {
        const res = await apiFetch(`${API_URL}/api/arcade/play/coinflip`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ bet, choice })
        });

        const data = await res.json();

        if (!res.ok || data.error) {
            resultEl.innerText = data.error || "Something went wrong.";
            return;
        }

        // -------- RESULT --------
        resultEl.innerText = data.win
            ? `You won! Result: ${data.result}`
            : `You lost. Result: ${data.result}`;

        // -------- UPDATE STATS --------
        document.getElementById("coins").innerText = data.coins;
        document.getElementById("xp").innerText = data.xp;

    } catch (err) {
        console.error("Coinflip error:", err);
        resultEl.innerText = "Network error.";
    } finally {
        // -------- UI UNLOCK --------
        headsBtn.disabled = false;
        tailsBtn.disabled = false;
    }
}
