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
    // Cinematic pause.
    // ==============================

    setTimeout(() => {

        columns.forEach(column => {

            const topSegment = column.querySelector(".segment.top");
            const bottomSegment = column.querySelector(".segment.bottom");

            // grotere random delay voor zichtbare spreiding
            const delay = Math.random() * 1200;

            setTimeout(() => {
                topSegment.style.transform = "translateY(-120%)";
                bottomSegment.style.transform = "translateY(120%)";
            }, delay);

        });

    }, 1500);


    // ==============================
    // Fade out.
    // ==============================

    // Fade zodra laatste shutter ongeveer klaar is
    setTimeout(() => {
        opening.style.transition = "opacity 0.6s ease";
        opening.style.opacity = "0";

        setTimeout(() => {
            opening.remove();
        }, 600);

    }, 3000);


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
