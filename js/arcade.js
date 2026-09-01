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

    let arcadeData;

    try {
        const arcadeRes = await apiFetch(`${API_URL}/api/arcade/profile`);
        arcadeData = await arcadeRes.json();
    } catch (error) {
        console.error("Arcade stats load failed:", error);
        return;
    }

    document.getElementById("coins").innerText = arcadeData.coins;
    document.getElementById("xp").innerText = arcadeData.xp;
    document.getElementById("level").innerText = arcadeData.level;

    // XP progress (voorbeeld)
    const progress = (arcadeData.xp % 100) + "%";
    document.getElementById("xp-progress").style.width = progress;
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

    const update = () => {
        const scrollY = window.scrollY || 0;
        document.body.classList.toggle("arcade-profile-pinned", scrollY > 260);

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
