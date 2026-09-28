// Het script van __profile_harness.html. Stond inline in de pagina; de
// Content Security Policy staat geen inline scripts toe.

import { gatewayClient } from "/vm/core/gatewayClient.js";
import { registerProfileSite, refreshProfile } from "/vm/apps/browser/sites/profile.js";

const status = document.getElementById("status");
const frame = document.getElementById("frame");

// Een profiel met precies de velden waar het om gaat. De getallen zijn
// herkenbaar gekozen zodat een verwisseling in de opmaak opvalt.
const PROFIEL = {
    user_id: "424242", level: 79, xp: 123456, xp_to_next_level: 200000,
    xp_into_level: 123456, equipped_title: null, titles: [], achievements: [],
    joined: "2025-01-01T00:00:00+00:00", last_login: null, total_logins: 0,
    streak: 3, hours_worked: 12,
    organization: {
        id: 1, name: "CyTek Industries", emblem: "◈", slug: "cytek",
        rank: "commander",
        reputation: 4200,
        contribution: 987654,
        season_contribution: 54321,
        specialisation: "analyst",
        warnings: 0,
    },
    // 500 + 1000 + level 79 x bank.limit_per_level (90.000). Stond op 793.000
    // toen dat tarief nog 10.000 was; de backend rekent het echte getal uit de
    // config en dit harnas heeft geen backend, dus het staat hier met de hand.
    coins: 1000, bank: 2000, bank_limit: 7111500, bank_limit_base: 500,
    bank_limit_bonus: 1000, networth: 3000, total_given: 0, total_received: 0,
    inventory_count: 0, active_items_count: 0, items: [], active_items: [],
    current_arc: null, unlocked_arcs: [], completed_arcs: [],
    active_quests_count: 0,
    security: {
        firewall_level: 2, active_security: "firewall_2", breached: true,
        last_breached_at: 1785183093,          // unix-SECONDEN: de 1970-val
        last_breached_by: "99", attack_scripts_count: 0, active_attack: null,
        security_scripts_count: 1, exposures: [],
    },
    work: null, windpark: null,
};

gatewayClient.hasAuthToken = () => true;
gatewayClient.fetchSelfPlayer = async () => ({ ok: true, status: 200, data: { item: PROFIEL } });

const sites = [];
registerProfileSite({ register: (s) => sites.push(s), registerMatcher: () => {} });

await refreshProfile();

const home = sites.find((s) => s.id === "profile-home");
frame.innerHTML = home.render();

// Wat de test uitleest.
const tekst = frame.innerText || frame.textContent || "";
window.__resultaat = {
    sites: sites.length,
    bevat_contribution: tekst.includes("Contribution (lifetime)"),
    bevat_seizoen: tekst.includes("This term:"),
    contributiewaarde: /Contribution \(lifetime\):\s*([\d.,]+)/.exec(tekst)?.[1] || null,
    seizoenwaarde: /This term:\s*([\d.,]+)/.exec(tekst)?.[1] || null,
    specialisatie: tekst.includes("analyst"),
    actiefzin: tekst.includes("You count as an active member this term."),
    breached_tekst: /Breached at\s*([^\n]*)/.exec(tekst)?.[1]?.trim() || null,
    toont_1970: tekst.includes("1970"),
};
status.textContent = JSON.stringify(window.__resultaat, null, 2);
document.body.dataset.klaar = "1";
