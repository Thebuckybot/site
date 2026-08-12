/**
 * mailSeed — authored seed mail for the Bucky Mail Platform (Phase 5.0).
 *
 * The believable starting inbox/sent history the operator boots into. It is the
 * mail equivalent of the VM filesystem's seed tree: authored content that ships
 * with the build, addressed to the CURRENT operator at runtime so it lands in
 * whoever's mailbox is active.
 *
 * Content mirrors the Outlook-style concept reference: a firewall alert with a
 * log attachment, NPC/story senders (ShadowNet, Null Division), system notices,
 * contracts, and a dead-drop. There are deliberately MORE than ten inbox
 * messages so the UI's "last 10" render cap is exercised while nothing is
 * deleted (history is preserved; the cap is purely a render limit).
 *
 * `buildSeed(operatorAddress)` returns plain data; MailService turns it into
 * messages/recipients/attachments. Pure data — DOM-free.
 */

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

export function buildSeed(operatorAddress) {
    const to = [operatorAddress];

    // ----- Inbox (newest first; `ago` = how long before "now") --------------
    const inbox = [
        {
            from: "security@bucky.net", display: "Bucky Security System",
            subject: "Firewall Alert: Intrusion Blocked", priority: "alert",
            source: "system", read: false, ago: 16 * MIN, to,
            body:
                "Operator,\n\n" +
                "An intrusion attempt was detected and blocked by your active firewall.\n\n" +
                "Threat Level:  High\n" +
                "Source IP:  195.22.134.76\n" +
                "Action Taken:  Connection Blocked\n" +
                "Firewall:  Firewall III\n" +
                "Timestamp:  2025-05-23 13:31:02\n\n" +
                "No further action is required.\n\n" +
                "Stay secure,\n" +
                "– Bucky Security System",
            attachments: [{
                filename: "firewall_log_20250523_133102.txt", mime: "text/plain",
                content:
                    "[2025-05-23 13:31:02] BLOCK src=195.22.134.76 dst=10.0.0.4 proto=TCP dport=22 flags=SYN\n" +
                    "[2025-05-23 13:31:02] RULE firewall-iii/deny-bruteforce matched (threshold 12/min)\n" +
                    "[2025-05-23 13:31:03] BLOCK src=195.22.134.76 dst=10.0.0.4 proto=TCP dport=22 flags=SYN\n" +
                    "[2025-05-23 13:31:04] GEOIP src=195.22.134.76 cc=?? asn=AS-UNKNOWN\n" +
                    "[2025-05-23 13:31:05] SUMMARY blocked=37 window=60s action=connection-dropped\n"
            }]
        },
        {
            from: "intel@shadownet.mail", display: "ShadowNet",
            subject: "You are asking dangerous questions", priority: "high",
            source: "authored", read: false, ago: 49 * MIN, to,
            body:
                "Stop looking into Null Division.\n\n" +
                "We see the queries you are running against the breach index. This is the\n" +
                "only warning you will get. Walk away from the infrastructure leak and\n" +
                "delete what you have already pulled.\n\n" +
                "You do not want us to send a second message.",
            attachments: [{
                filename: "redacted_notice.txt", mime: "text/plain",
                content: "SUBJECT: ████████\nFILE: null_division/██████\nSTATUS: REDACTED\nNOTE: last access traced.\n"
            }]
        },
        {
            from: "recruitment@nulldivision.mail", display: "Null Division",
            subject: "Weekly Intelligence Briefing", priority: "normal",
            source: "authored", read: false, ago: 125 * MIN, to,
            body:
                "Here is your weekly briefing. Stay sharp.\n\n" +
                "1. Corporate target HELIX-DYNAMICS rotated their VPN certs early.\n" +
                "2. The Financial District contract board is unusually active.\n" +
                "3. Three new operators flagged on the watchlist - see attachment.\n\n" +
                "Burn after reading.",
            attachments: [{
                filename: "weekly_briefing.txt", mime: "text/plain",
                content: "WATCHLIST ADDITIONS\n- handle: dustfinch  risk: medium\n- handle: gnawworm   risk: high\n- handle: brassvole  risk: low\n"
            }]
        },
        {
            from: "contracts@market.mail", display: "Market Contracts",
            subject: "New Contract Opportunity", priority: "normal",
            source: "authored", read: false, ago: 210 * MIN, to,
            body:
                "Data Recovery – Financial District\n\n" +
                "A client needs a corrupted ledger archive recovered from a decommissioned\n" +
                "node. Discretion required.\n\n" +
                "Payout:   4,500 cr\n" +
                "Deadline: 72 hours\n" +
                "Risk:     Moderate\n\n" +
                "Accept from the contract board or reply to this message.",
            attachments: [{
                filename: "contract_terms.json", mime: "application/json",
                content: '{\n  "contract_id": "FD-4471",\n  "type": "data-recovery",\n  "district": "financial",\n  "payout_cr": 4500,\n  "deadline_hours": 72,\n  "risk": "moderate"\n}\n'
            }]
        },
        {
            from: "system@bucky.net", display: "Bucky OS",
            subject: "System Maintenance Notice", priority: "normal",
            source: "system", read: true, ago: 297 * MIN, to,
            body:
                "Scheduled maintenance will occur at 02:00 node-local time.\n\n" +
                "Expect a brief interruption to BuckyNet and the leak index. Open sessions\n" +
                "will be preserved. No action is required.\n\n" +
                "– Bucky OS"
        },

        // ----- Yesterday --------------------------------------------------------
        {
            from: "anonymous@unknown.mail", display: "anonymous",
            subject: "Dead drop coordinates", priority: "high",
            source: "authored", read: true, ago: 26 * HOUR, to,
            body:
                "Meet me if you want the data.\n\n" +
                "Coordinates attached. Come alone, leave your relay off, and do not bring\n" +
                "anything that phones home.",
            attachments: [{
                filename: "dead_drop.txt", mime: "text/plain",
                content: "DROP: sublevel 3, locker 114\nWINDOW: 23:40 - 23:55\nKEY: ask for \"the archivist\"\n"
            }]
        },
        {
            from: "security@bucky.net", display: "Bucky Security System",
            subject: "Login Attempt Detected", priority: "high",
            source: "system", read: false, ago: 27 * HOUR, to,
            body:
                "A login attempt from an unknown device was blocked.\n\n" +
                "Device:   unrecognised\n" +
                "Location: masked\n" +
                "Result:   blocked, session not created\n\n" +
                "If this was you, you can ignore this notice."
        },
        {
            from: "intel@shadownet.mail", display: "ShadowNet",
            subject: "Leak: City Infrastructure", priority: "normal",
            source: "authored", read: true, ago: 28 * HOUR, to,
            body: "Attached is what you asked for. Handle carefully - this one is hot.",
            attachments: [{
                filename: "city_infrastructure.csv", mime: "text/csv",
                content: "node,district,status,exposed\nwater-04,industrial,online,yes\ngrid-11,financial,degraded,yes\ntransit-02,central,offline,no\n"
            }]
        },
        {
            from: "recruitment@cybersec.mail", display: "CyberSec Initiative",
            subject: "Join CyberSec Initiative", priority: "normal",
            source: "authored", read: true, ago: 30 * HOUR, to,
            body: "We think you'd be a great fit. Reply if you want to talk about defensive work for a change."
        },
        {
            from: "contracts@market.mail", display: "Market Contracts",
            subject: "Contract Update", priority: "normal",
            source: "authored", read: true, ago: 31 * HOUR, to,
            body: "Your contract status has been updated. Check the board for details."
        },

        // ----- Older (beyond the visible 10 — preserved, never deleted) ---------
        {
            from: "system@bucky.net", display: "Bucky OS",
            subject: "Welcome to Bucky Mail", priority: "normal",
            source: "system", read: true, ago: 3 * 24 * HOUR, to,
            body: "Your operator mailbox is active. System notices, contracts and intel will arrive here."
        },
        {
            from: "support@bucky.net", display: "Bucky Support",
            subject: "Getting started", priority: "normal",
            source: "system", read: true, ago: 3 * 24 * HOUR + HOUR, to,
            body: "Open a message to read it. Use Compose to send mail. Attachments can be saved to /mail/attachments."
        },
        {
            from: "security@bucky.net", display: "Bucky Security System",
            subject: "Weekly security digest", priority: "normal",
            source: "system", read: true, ago: 4 * 24 * HOUR, to,
            body: "0 critical alerts this week. Firewall III is active. Your account is in good standing."
        },
        {
            from: "intel@shadownet.mail", display: "ShadowNet",
            subject: "Re: your inquiry", priority: "normal",
            source: "authored", read: false, ago: 5 * 24 * HOUR, to,
            body: "Not over this channel. If you are serious, you know where the drop is."
        }
    ];

    // ----- Sent (from the operator) -----------------------------------------
    const sent = [
        {
            from: operatorAddress, to: ["intel@shadownet.mail"],
            subject: "Information request", source: "composed", ago: 90 * MIN,
            body: "Following up on the Null Division breach. Do you have anything on the timeline?"
        },
        {
            from: operatorAddress, to: ["contracts@market.mail"],
            subject: "Re: New Contract Opportunity", source: "composed", ago: 4 * HOUR,
            body: "I'm interested in the Data Recovery contract. What are the access terms?"
        },
        {
            from: operatorAddress, to: ["security@bucky.net"],
            subject: "Login alert follow-up", source: "composed", ago: 29 * HOUR,
            body: "Confirming the blocked login was not me. Please review and keep the block in place."
        }
    ];

    return { inbox, sent };
}
