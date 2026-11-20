// veille.mjs — robot d'alertes Helix Sécurité (lancé toutes les 15 min par GitHub Actions)
// 1. lit le BOAMP, le TED et marches-securises.fr (Var, sécurité / gardiennage)
// 2. compare avec data/offres.json (offres déjà connues)
// 3. envoie une notification ntfy pour chaque NOUVELLE offre
// 4. met à jour data/offres.json (relu par la tâche Claude qui alimente l'application)
import { readFile, writeFile } from "node:fs/promises";
import { fetchOpenOffers, fetchNearby13, CATS, score } from "../lib/boamp.js";
import { fetchTedOffers, isDuplicate } from "./ted.mjs";
import { fetchMsecuOffers } from "./msecu.mjs";

const { NTFY_TOPIC, APP_URL = "", NTFY_SERVER = "https://ntfy.sh" } = process.env;
const STATE = new URL("../data/offres.json", import.meta.url);
if (!NTFY_TOPIC) { console.error("Secret NTFY_TOPIC manquant (Settings → Secrets and variables → Actions)."); process.exit(1); }

const fmtDT = s => new Date(s).toLocaleString("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });
const link = id => APP_URL ? APP_URL.replace(/#.*$/, "") + "#offre-" + id.replace(/[^A-Za-z0-9-]/g, "-") : undefined;

async function push(msg) {
  const r = await fetch(NTFY_SERVER.replace(/\/$/, ""), { method: "POST", body: JSON.stringify({ topic: NTFY_TOPIC, ...msg }) });
  if (!r.ok) console.error("ntfy :", r.status, await r.text());
}
const SRC = { boamp: "BOAMP", ted: "TED (Europe)", msecu: "Marchés-sécurisés" };
function offerMessage(o) {
  const lines = [o.titre, "", "🏛 " + o.acheteur, "📍 " + o.ville + (o.km === 0 ? " (Brignoles)" : o.km != null ? ` (≈ ${o.km} km de Brignoles)` : "")];
  if (o.limite) lines.push("⏱ Date limite : " + fmtDT(o.limite));
  if (o.montant) lines.push("💶 " + new Intl.NumberFormat("fr-FR").format(o.montant) + " €");
  const actions = [];
  if (link(o.id)) actions.push({ action: "view", label: "Ouvrir Helix Veille", url: link(o.id) });
  if (o.avis) actions.push({ action: "view", label: SRC[o.source] ? "Voir sur " + SRC[o.source] : "Avis BOAMP", url: o.avis });
  lines.push("", "Source : " + (SRC[o.source] || "BOAMP"));
  return {
    title: `Nouvel appel d'offres · ${CATS[o.cat]?.label || "Sécurité"}`, message: lines.join("\n"),
    tags: [o.cat === "gardiennage" ? "rotating_light" : "shield"], priority: o.cat === "gardiennage" || score(o) >= 70 ? 5 : 4,
    click: o.avis || link(o.id), actions
  };
}

async function main() {
  let state = { maj: null, offres: {} };
  try { state = JSON.parse(await readFile(STATE, "utf8")); } catch (e) { }
  const firstRun = !state.maj;

  const [boamp, near13, ted, msecu] = await Promise.all([
    fetchOpenOffers().catch(e => { console.error("BOAMP :", e.message); return null; }),
    fetchNearby13().catch(e => { console.error("BOAMP 13 :", e.message); return []; }),
    fetchTedOffers().catch(e => { console.error("TED :", e.message); return []; }),
    fetchMsecuOffers().catch(e => { console.error("Marchés-sécurisés :", e.message); return null; })
  ]);
  if (!boamp) { console.error("BOAMP injoignable : nouvel essai au prochain passage."); return; }
  const all = [...boamp];
  for (const t of ted) if (!isDuplicate(t, all)) all.push(t);
  // Marchés-sécurisés : si le marché est déjà au BOAMP, on garde la fiche BOAMP et on ajoute le lien de la plateforme
  let nMs = 0;
  if (msecu) for (const m of msecu) {
    const twin = all.find(b => isDuplicate(m, [b]) || isDuplicate(b, [m]));
    if (twin) { twin.aussi = [...new Set([...(twin.aussi || []), "msecu"])]; if (!twin.plateforme) twin.plateforme = m.plateforme; }
    else { all.push(m); nMs++; }
  }
  if (msecu) console.log(`Marchés-sécurisés : ${msecu.length} consultation(s) pertinente(s), dont ${msecu.length - nMs} déjà au BOAMP/TED`);
  else for (const o of Object.values(state.offres)) if (o.source === "msecu" && !all.some(a => a.id === o.id)) all.push(o); // site injoignable : on garde les offres connues
  for (const o of near13) if (!all.some(a => a.id === o.id)) all.push(o);  // Bouches-du-Rhône proches : enregistrées, sans notification
  console.log(`Offres ouvertes : ${boamp.length} BOAMP + ${nMs} Marchés-sécurisés + autres (TED, 13) : ${all.length} au total`);

  const now = new Date().toISOString();
  const fresh = all.filter(o => !state.offres[o.id] && o.dep !== "13");
  const offres = {};
  // on garde les offres connues encore ouvertes + celles closes depuis moins de 30 jours (pour l'historique)
  for (const [id, o] of Object.entries(state.offres)) if (!o.limite || new Date(o.limite) > Date.now() - 30 * 864e5) offres[id] = o;
  for (const o of all) offres[o.id] = { ...o, first_seen: state.offres[o.id]?.first_seen || now };

  if (firstRun) {
    await push({ title: "Helix Veille est activée", message: `${all.filter(o => o.dep !== "13").length} appel(s) d'offres sécurité ouvert(s) dans le Var. Vous serez prévenu à chaque nouvelle publication.`, tags: ["white_check_mark"], click: APP_URL || undefined });
  } else if (fresh.length > 8) {
    await push({ title: `${fresh.length} nouveaux appels d'offres sécurité`, message: fresh.slice(0, 8).map(o => "• " + o.titre).join("\n"), tags: ["rotating_light"], priority: 5, click: APP_URL || undefined });
  } else {
    for (const o of fresh.sort((a, b) => score(b) - score(a))) await push(offerMessage(o));
  }
  console.log(`Nouvelles offres notifiées : ${firstRun ? 0 : fresh.length}`);

  const changed = fresh.length || firstRun || Object.keys(offres).length !== Object.keys(state.offres).length
    || all.some(o => JSON.stringify(o.aussi || []) !== JSON.stringify(state.offres[o.id]?.aussi || []));
  if (changed) await writeFile(STATE, JSON.stringify({ maj: now, offres }, null, 1) + "\n");
  else console.log("Aucun changement.");
}

main().catch(e => { console.error(e); process.exit(1); });
