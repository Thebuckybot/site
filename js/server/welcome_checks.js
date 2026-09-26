// De controles op een afbeelding, in de browser.
//
// DE SERVER IS DE WAARHEID. Alles hier staat ook in
// backend/api/server_center/welcome_layout.py, en daar wordt het afgedwongen.
// Dit bestand bestaat om het EERDER te zeggen: voordat twee megabyte over de
// lijn is gegaan, en - bij een geplakte link - voordat de preview hem ophaalt.
//
// DAT LAATSTE IS GEEN GEMAK MAAR DE REDEN VAN DE ALLOWLIST. Een vrije URL in de
// preview is een baken: het IP van iedere beheerder die het scherm opent gaat
// naar die host (zie ADR 0003 en 02 - Beslissingen, 26 september). Tot vandaag
// zette de preview elke getypte URL rechtstreeks in een <img>, bij elke
// toetsaanslag. `magTonen` is de poort daarvoor.
//
// De woorden zijn die van de server, zodat een melding er hetzelfde uitziet
// ongeacht welke kant hem het eerst gaf.

const EXTENSIES = [".png", ".jpg", ".jpeg", ".gif", ".webp"];
const TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

/** `3.0 MB`, `740 KB` - dezelfde afronding als `grootte_tekst` in de backend. */
export function grootteTekst(n) {
  if (n >= 1048576) return (n / 1048576).toFixed(1) + " MB";
  return Math.max(1, Math.round(n / 1024)) + " KB";
}

function hostsTekst(hosts) {
  return [...hosts].sort().join(", ");
}

/**
 * De fout in een geplakte afbeeldingslink, of null als hij mag.
 * `hosts` komt uit `limits.image_hosts` van GET /welcome: dezelfde lijst als
 * de server gebruikt, niet een kopie die kan gaan afwijken.
 */
export function urlFout(url, hosts, naam = "The image") {
  const tekst = String(url || "").trim();
  if (!tekst) return null;
  let deel;
  try { deel = new URL(tekst); } catch (_) {
    return `${naam} link is not a web address. It has to start with https://.`;
  }
  if (deel.protocol !== "https:") return `${naam} must start with https://.`;
  const host = deel.hostname.toLowerCase();
  if (!(hosts || []).includes(host)) {
    return `Images can only be linked from ${hostsTekst(hosts || [])}. `
         + `${host || "That address"} is not one of them - upload the image instead.`;
  }
  const pad = deel.pathname.toLowerCase();
  if (!EXTENSIES.some((e) => pad.endsWith(e))) {
    const laatste = pad.split("/").pop();
    const ext = laatste.includes(".") ? "." + laatste.split(".").pop() : "no extension";
    return `${naam} must be a .png, .jpg, .gif or .webp file; this link ends in ${ext}.`;
  }
  return null;
}

/**
 * Mag de preview deze URL ophalen? Alleen wat de server ook zou aannemen, plus
 * `data:image/...` - dat haalt niets op en is dus geen baken.
 */
export function magTonen(url, hosts) {
  const tekst = String(url || "").trim();
  if (!tekst) return false;
  if (/^data:image\/(png|jpeg|gif|webp);/i.test(tekst)) return true;
  return urlFout(tekst, hosts) === null;
}

/**
 * De fout in een gekozen bestand, of null. Het TYPE is hier wat de browser
 * zegt (naam en extensie); de server kijkt naar de bytes en heeft het laatste
 * woord. Een HTML-bestand dat banner.png heet komt hier dus door en wordt daar
 * geweigerd - met een melding die dat verschil noemt.
 */
export function bestandFout(bestand, limieten, aantal) {
  const max = limieten.max_uploads || 10;
  if (aantal >= max) {
    return `This server already has ${aantal} of ${max} uploaded images, the most it `
         + `can keep. Pick one of them from the list instead; removing uploads is `
         + `not possible from this screen yet.`;
  }
  const grens = limieten.max_upload_bytes || 2097152;
  if (bestand.size > grens) {
    return `That image is ${grootteTekst(bestand.size)}. The limit is `
         + `${Math.floor(grens / 1048576)} MB. Make it smaller, or save it as a JPEG, `
         + `and try again.`;
  }
  const soort = (bestand.type || "").toLowerCase();
  if (!TYPES.includes(soort)) {
    const wat = soort ? `is ${soort}` : "has a type the browser does not recognise";
    return `${bestand.name || "That file"} ${wat}. Only PNG, JPEG, GIF or WebP `
         + `images can be uploaded.`;
  }
  if (bestand.size === 0) return "That file is empty.";
  return null;
}
