import { API_URL } from "./config.js";
import { apiFetch } from "./dashboard.js";

document.addEventListener("DOMContentLoaded", () => {


    const opening = document.getElementById("arcade-opening");
    const topSegments = document.querySelectorAll(".segment.top");
    const bottomSegments = document.querySelectorAll(".segment.bottom");

    // 1️⃣ Cinematic pause
    setTimeout(() => {

        topSegments.forEach((segment, index) => {
            setTimeout(() => {
                segment.style.transform = "translateY(-120%)";
            }, index * 120);
        });

        bottomSegments.forEach((segment, index) => {
            setTimeout(() => {
                segment.style.transform = "translateY(120%)";
            }, index * 120);
        });

    }, 1500); // iets langere pause

    // 2️⃣ Fade overlay uit
    setTimeout(() => {
        opening.style.transition = "opacity 0.6s ease";
        opening.style.opacity = "0";

        setTimeout(() => {
            opening.style.display = "none";
            document.body.style.overflow = "auto";
        }, 600);

    }, 3800);

    loadProfile();

    document.getElementById("heads-btn")
        .addEventListener("click", () => playCoinflip("heads"));

    document.getElementById("tails-btn")
        .addEventListener("click", () => playCoinflip("tails"));
});

async function loadProfile() {
    const res = await apiFetch(`${API_URL}/api/arcade/profile`);
    const data = await res.json();

    if (data.error) {
        alert(data.error);
        return;
    }

    document.getElementById("coins").innerText = data.coins;
    document.getElementById("xp").innerText = data.xp;
    document.getElementById("level").innerText = data.level;
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