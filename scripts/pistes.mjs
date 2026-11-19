// pistes.mjs — construit docs/pistes.json : toutes les pistes commerciales du Var hors appels d'offres.
//  • Marchés de sécurité déjà passés (DECP, data.economie.gouv.fr) : qui achète, titulaire, date de fin estimée
//  • Festivals du Var (ministère de la Culture, data.gouv.fr) : organisateur, e-mail, période
//  • Nouvelles ouvertures (annuaire des entreprises, recherche-entreprises.api.gouv.fr) : hôtels, campings, grandes surfaces…
//  • Syndics de copropriété et promoteurs immobiliers du Var (même annuaire)
// Lancé une fois par semaine par GitHub Actions (et à la demande).
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const DEP = "83";
const BRIGNOLES = { lat: 43.4058, lon: 6.0616 };
const ODS = "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/";
const RE = "https://recherche-entreprises.api.gouv.fr/search";
const FESTIVALS_DATASET = "https://www.data.gouv.fr/api/1/datasets/?q=Liste%20des%20festivals%20en%20France&organization=&page_size=5";
const NOW = new Date();

export const GROUPES = {
  decp: { label: "Marchés à renouveler", base: 55, plaque: "gardiennage" },
  festival: { label: "Festivals", base: 45, plaque: "evenementiel" },
  ouverture: { label: "Nouvelles ouvertures", base: 45, plaque: "gardiennage" },
  promoteur: { label: "Promoteurs · chantiers", base: 40, plaque: "gardiennage" },
  syndic: { label: "Syndics de copropriété", base: 35, plaque: "gardiennage" }
};

// Activités (NAF) suivies pour les nouvelles ouvertures, avec l'angle commercial
export const NAF_OUVERTURES = {
  "55.10Z": ["Hôtel", "Sécurité de nuit, contrôle des accès, renfort en saison et pour les événements."],
  "55.20Z": ["Résidence de tourisme", "Gardiennage de nuit et rondes en saison, fermeture hivernale surveillée."],
  "55.30Z": ["Camping", "Rondes de nuit en saison, contrôle des entrées, gestion des nuisances et des tensions."],
  "47.11D": ["Supermarché", "Agents de prévention des vols, contrôle en sortie, renfort aux heures d'affluence."],
  "47.11F": ["Hypermarché", "Agents de prévention des vols, SSIAP, renfort pendant les fêtes."],
  "52.10B": ["Entrepôt", "Gardiennage de nuit et du week-end, rondes, levée de doute sur alarme."],
  "45.11Z": ["Concession automobile", "Gardiennage de nuit du parc de véhicules, rondes, levée de doute."],
  "47.77Z": ["Bijouterie", "Agent d'accueil et de sécurité, contrôle d'accès, prévention des vols."],
  "93.13Z": ["Salle de sport", "Contrôle d'accès et présence en soirée."],
  "56.30Z": ["Bar · discothèque", "Contrôle d'accès en soirée, gestion des tensions, sécurité de la sortie."],
  "93.21Z": ["Parc de loisirs", "Contrôle des entrées, gestion des flux, sécurité en saison."],
  "82.30Z": ["Organisateur de salons et événements", "Sécurité événementielle : contrôle d'accès, palpation, gestion des flux."]
};
const NAF_ANNUAIRES = {
  "41.10A": ["promoteur", "Promoteur immobilier", "Gardiennage de vos chantiers la nuit et le week-end, rondes, levée de doute : vols de matériaux et intrusions évités."],
  "68.32A": ["syndic", "Syndic de copropriété", "Gardiennage et rondes pour vos résidences, médiation, sécurisation des parkings et des parties communes."]
};
const OUVERTURE_MOIS = 24;

// ---------- Outils ----------
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rad = d => d * Math.PI / 180;
export function km(lat, lon) {
  lat = +lat; lon = +lon;
  if (!isFinite(lat) || !isFinite(lon) || (!lat && !lon)) return null;
  const a = Math.sin(rad(lat - BRIGNOLES.lat) / 2) ** 2 + Math.cos(rad(lat)) * Math.cos(rad(BRIGNOLES.lat)) * Math.sin(rad(lon - BRIGNOLES.lon) / 2) ** 2;
  return Math.round(6371 * 2 * Math.asin(Math.sqrt(a)) * 1.25);
}
const kmPts = k => k == null ? 10 : k <= 30 ? 30 : k <= 60 ? 20 : k <= 100 ? 10 : 0;
const clamp = s => Math.max(5, Math.min(100, Math.round(s)));
const SMALL = new Set(["de", "du", "des", "la", "le", "les", "et", "d", "l", "à", "au", "aux", "en", "sur", "sous"]);
export function nice(s) {
  s = String(s || "").trim().replace(/\s+/g, " ");
  if (!s || /[a-zà-ÿ]/.test(s)) return s;
  return s.toLowerCase().split(/(\s+|-|')/).map((w, i) => (i && SMALL.has(w)) ? w : w.charAt(0).toUpperCase() + w.slice(1)).join("")
    .replace(/\b(Sas|Sarl|Sa|Sci|Eurl|Snc|Sasu|Ccas|Sivom|Sivu|Epci|Ch|Chu|Ehpad|Crous|Caf|Cpam|Sdis|Opac|Oph)\b/g, w => w.toUpperCase());
}
async function getJSON(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "helix-veille (github.com/helix-veille)" } });
      if (r.status === 429) { await sleep(2000 * (i + 1)); continue; }
      if (!r.ok) throw new Error(r.status + " " + url);
      return await r.json();
    } catch (e) { if (i === tries - 1) throw e; await sleep(1000 * (i + 1)); }
  }
}
const addMonths = (d, m) => { const x = new Date(d); x.setMonth(x.getMonth() + m); return x; };
const moisAnnee = d => d.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });

// ---------- Annuaire des entreprises (avec cache) ----------
const cacheSiret = new Map();
async function entreprise(siret) {
  const s = String(siret || "").replace(/\D/g, "");
  if (s.length < 9) return null;
  if (cacheSiret.has(s)) return cacheSiret.get(s);
  let res = null;
  try {
    await sleep(160);
    const j = await getJSON(`${RE}?q=${s}&per_page=1`);
    const e = j.results?.[0];
    if (e) {
      const m = (e.matching_etablissements || []).find(x => x.siret === s) || e.siege || {};
      res = { nom: nice(e.nom_complet), adresse: m.adresse || e.siege?.adresse || "", cp: m.code_postal || e.siege?.code_postal || "", ville: nice(m.libelle_commune || e.siege?.libelle_commune || ""), lat: m.latitude || e.siege?.latitude, lon: m.longitude || e.siege?.longitude };
    }
  } catch (e) { }
  cacheSiret.set(s, res);
  return res;
}

// ---------- 1. Marchés de sécurité déjà passés (DECP) ----------
const CPV = ["7971", "98341140", "7525111"];
export function decpRecord(r, acheteur, titulaire) {
  const notif = new Date(r.datenotification);
  const duree = Math.max(1, Math.min(96, parseInt(r.dureemois, 10) || 12));
  const fin = addMonths(notif, duree);
  const moisRestants = Math.round((fin - NOW) / (30.4 * 864e5));
  const k = acheteur ? km(acheteur.lat, acheteur.lon) : null;
  const urg = moisRestants <= 6 ? 25 : moisRestants <= 12 ? 15 : moisRestants <= 18 ? 5 : 0;
  const objet = String(r.objet || "").replace(/\s+/g, " ").trim();
  const montant = parseFloat(r.montant) || null;
  return {
    id: "pi-decp-" + String(r.id || "").replace(/[^\w.-]/g, "") + "-" + String(r.acheteur_id || "").slice(-6),
    kind: "piste", grp: "decp", cat: "gardiennage", plaque: "gardiennage",
    titre: acheteur?.nom || nice(r.acheteur_nom) || "Acheteur public",
    type: objet.charAt(0).toUpperCase() + objet.slice(1).toLowerCase(),
    acheteur: acheteur?.nom || "", adresse: acheteur?.adresse || "", cp: acheteur?.cp || "", ville: acheteur?.ville || "",
    km: k, tel: "", email: "", web: "",
    titulaire: titulaire?.nom || "", montant, duree: duree + " mois", notif: r.datenotification, fin: fin.toISOString().slice(0, 10),
    badge: moisRestants < 0 ? "Fin dépassée : relance imminente" : `Fin estimée : ${moisAnnee(fin)}`,
    extra: [titulaire?.nom ? "Titulaire : " + titulaire.nom : "", montant ? "Montant : " + Math.round(montant).toLocaleString("fr-FR") + " €" : "", "Notifié le " + notif.toLocaleDateString("fr-FR") + " · " + duree + " mois"].filter(Boolean),
    procedure: r.procedure || "",
    note: `Le contrat actuel se termine vers ${moisAnnee(fin)} : l'acheteur relancera une consultation quelques mois avant. Se présenter dès maintenant pour être consulté, et proposer des renforts au titulaire en attendant.`,
    prio: clamp(GROUPES.decp.base + kmPts(k) + urg - (montant > 2e6 ? 10 : 0))
  };
}
async function fetchDecp() {
  const where = `(${CPV.map(c => `startswith(codecpv,"${c}")`).join(" OR ")}) AND (startswith(lieuexecution_code,"${DEP}"))`;
  const rows = [];
  for (const ds of ["decp-2022-marches-valides", "decp-v3-marches-valides"]) {
    for (let off = 0; off < 2000; off += 100) {
      let j;
      try { j = await getJSON(`${ODS}${ds}/records?limit=100&offset=${off}&order_by=datenotification%20desc&where=${encodeURIComponent(where)}`); } catch (e) { console.warn("DECP", ds, e.message); break; }
      rows.push(...(j.results || []));
      if (!j.results || j.results.length < 100) break;
    }
  }
  // Garde les contrats qui se terminent entre il y a 6 mois et dans 30 mois ; un seul par acheteur + objet
  const seen = new Map();
  for (const r of rows) {
    if (!r.datenotification || !r.acheteur_id) continue;
    const fin = addMonths(new Date(r.datenotification), Math.max(1, parseInt(r.dureemois, 10) || 12));
    const m = (fin - NOW) / (30.4 * 864e5);
    if (m < -6 || m > 30) continue;
    const key = r.acheteur_id + "|" + String(r.objet || "").toLowerCase().replace(/lot\s*\d+.*$/i, "").slice(0, 40);
    const prev = seen.get(key);
    if (!prev || new Date(r.datenotification) > new Date(prev.datenotification)) seen.set(key, r);
  }
  const out = [];
  for (const r of seen.values()) {
    const acheteur = await entreprise(r.acheteur_id);
    const titulaire = await entreprise(r.titulaire_id_1);
    out.push(decpRecord(r, acheteur, titulaire));
  }
  return out;
}

// ---------- 2. Festivals ----------
export function parseCsvLine(line) {
  const out = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true; else if (c === ";") { out.push(cur); cur = ""; } else cur += c;
  }
  out.push(cur); return out;
}
export function festivalRecords(text, maxKm13 = 70) {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter(Boolean);
  const head = parseCsvLine(lines[0]).map(h => h.trim());
  const col = name => head.findIndex(h => h.toLowerCase().startsWith(name.toLowerCase()));
  const C = { nom: col("Nom du festival"), dep: col("Département principal"), commune: col("Commune principale"), cp: col("Code postal"), adr: col("Adresse postale"),
    web: col("Site internet"), mail: col("Adresse e-mail"), disc: col("Discipline dominante"), per: col("Période principale"), geo: col("Géocodage"), id: col("Identifiant"), env: col("Envergure") };
  const out = [];
  for (const l of lines.slice(1)) {
    const v = parseCsvLine(l);
    const dep = (v[C.dep] || "").trim();
    if (dep !== "Var" && dep !== "Bouches-du-Rhône") continue;
    const [la, lo] = String(v[C.geo] || "").split(",").map(Number);
    const k = km(la, lo);
    if (dep === "Bouches-du-Rhône" && (k == null || k > maxKm13)) continue;
    const per = (v[C.per] || "").trim();
    const web = (v[C.web] || "").trim();
    out.push({
      id: "pi-fest-" + (v[C.id] || "").trim(), kind: "piste", grp: "festival", cat: "evenementiel", plaque: "evenementiel",
      titre: (v[C.nom] || "").trim(), type: ["Festival", (v[C.disc] || "").trim().toLowerCase(), (v[C.env] || "").trim() ? "envergure " + v[C.env].trim().toLowerCase() : ""].filter(Boolean).join(" · "),
      acheteur: "", adresse: (v[C.adr] || "").trim(), cp: (v[C.cp] || "").trim(), ville: (v[C.commune] || "").trim(), km: k,
      tel: "", email: (v[C.mail] || "").trim(), web: web && !/^https?:/i.test(web) ? "https://" + web : web,
      badge: per ? "Période : " + per.replace(/\s*\(.*\)/, "") : "", extra: per ? [per] : [],
      note: "Contacter l'organisateur 2 à 3 mois avant l'édition : contrôle d'accès, palpation, gestion des flux, sécurité de la scène et de la caisse.",
      prio: clamp(GROUPES.festival.base + kmPts(k) + (/saison/i.test(per) ? 5 : 0) + (dep === "Var" ? 0 : -10))
    });
  }
  return out;
}
async function fetchFestivals() {
  const d = await getJSON(FESTIVALS_DATASET);
  const ds = (d.data || []).find(x => /liste des festivals en france/i.test(x.title));
  const res = ds?.resources?.find(r => /csv/i.test(r.format || ""));
  if (!res) throw new Error("Fichier des festivals introuvable");
  const text = await (await fetch(res.url)).text();
  return festivalRecords(text);
}

// ---------- 3. Nouvelles ouvertures, syndics, promoteurs ----------
async function annuaire(naf, extraParams = "") {
  const all = [];
  for (let page = 1; page <= 120; page++) {
    let j;
    try { await sleep(170); j = await getJSON(`${RE}?activite_principale=${naf}&departement=${DEP}&etat_administratif=A&per_page=25&page=${page}${extraParams}`); }
    catch (e) { console.warn("annuaire", naf, page, e.message); break; }
    all.push(...(j.results || []));
    if (page >= (j.total_pages || 1)) break;
  }
  return all;
}
const EFFECTIF = { "01": "1 à 2 salariés", "02": "3 à 5 salariés", "03": "6 à 9 salariés", "11": "10 à 19 salariés", "12": "20 à 49 salariés", "21": "50 à 99 salariés", "22": "100 à 199 salariés", "31": "200 à 249 salariés", "32": "250 à 499 salariés", "41": "500 à 999 salariés", "42": "1 000 à 1 999 salariés", "51": "2 000 à 4 999 salariés", "52": "5 000 à 9 999 salariés", "53": "10 000 salariés et plus" };
// Taille minimale (tranche INSEE) pour qu'une structure ait réellement besoin d'agents de sécurité.
export const TAILLE_MIN = { "55.10Z": "03", "55.20Z": "11", "55.30Z": "03", "47.11D": "11", "47.11F": "01", "52.10B": "11", "45.11Z": "11", "47.77Z": "03", "93.13Z": "03", "56.30Z": "03", "93.21Z": "03", "82.30Z": "03" };
const TR = ["01", "02", "03", "11", "12", "21", "22", "31", "32", "41", "42", "51", "52", "53"];
const rang = t => TR.indexOf(String(t || ""));
// Assez grosse : tranche suffisante (entreprise ou établissement), ou enseigne d'un groupe (PME/ETI/GE avec 5 sites et plus).
export function assezGros(e, m, min) {
  if (!min) return true;
  const r = Math.max(rang(e.tranche_effectif_salarie), rang(m && m.tranche_effectif_salarie));
  if (r >= rang(min)) return true;
  if (String(e.nature_juridique || "").startsWith("1")) return false; // entrepreneur individuel
  return ["ETI", "GE"].includes(e.categorie_entreprise) || (e.categorie_entreprise === "PME" && (e.nombre_etablissements_ouverts || 0) >= 5);
}
export function etabRecords(results, naf, grp, label, angle, onlyRecentMonths = null, min = TAILLE_MIN[naf]) {
  const out = [], limit = onlyRecentMonths ? addMonths(NOW, -onlyRecentMonths) : null;
  for (const e of results) {
    const ets = (e.matching_etablissements || []).filter(m => String(m.code_postal || "").startsWith(DEP) && m.etat_administratif !== "F" && (!m.activite_principale || m.activite_principale === naf));
    for (const m of ets) {
      if (!assezGros(e, m, min)) continue;
      if (limit && (!m.date_creation || new Date(m.date_creation) < limit)) continue;
      const k = km(m.latitude, m.longitude);
      const ens = (m.liste_enseignes || []).filter(Boolean)[0];
      const nom = nice(ens || e.nom_complet);
      const recent = m.date_creation && new Date(m.date_creation) >= addMonths(NOW, -12);
      out.push({
        id: "pi-" + grp + "-" + m.siret, kind: "piste", grp, cat: "gardiennage", plaque: GROUPES[grp].plaque,
        titre: nom, type: label + (ens && nice(e.nom_complet) !== nom ? " · " + nice(e.nom_complet) : ""),
        acheteur: nice(e.nom_complet), adresse: nice(m.adresse || ""), cp: m.code_postal || "", ville: nice(m.libelle_commune || ""), km: k,
        tel: "", email: "", web: "", siret: m.siret,
        badge: m.date_creation ? (grp === "ouverture" ? "Ouvert le " : "Établi depuis ") + new Date(m.date_creation).toLocaleDateString("fr-FR", grp === "ouverture" ? { day: "numeric", month: "long", year: "numeric" } : { year: "numeric" }) : "",
        extra: [EFFECTIF[e.tranche_effectif_salarie] ? EFFECTIF[e.tranche_effectif_salarie] + " (entreprise)" : ""].filter(Boolean),
        note: angle,
        prio: clamp(GROUPES[grp].base + kmPts(k) + (recent ? 10 : 0))
      });
    }
  }
  return out;
}

async function main() {
  const out = [], log = {};
  try { const d = await fetchDecp(); out.push(...d); log.decp = d.length; } catch (e) { console.error("DECP :", e.message); }
  try { const f = await fetchFestivals(); out.push(...f); log.festival = f.length; } catch (e) { console.error("Festivals :", e.message); }
  for (const [naf, [label, angle]] of Object.entries(NAF_OUVERTURES)) {
    try { const r = etabRecords(await annuaire(naf), naf, "ouverture", label, angle, OUVERTURE_MOIS); out.push(...r); log[naf] = r.length; } catch (e) { console.error(naf, e.message); }
  }
  for (const [naf, [grp, label, angle]] of Object.entries(NAF_ANNUAIRES)) {
    // seulement les structures de 6 salariés et plus
    try { const r = etabRecords(await annuaire(naf, "&tranche_effectif_salarie=03,11,12,21,22,31,32,41,42,51,52,53"), naf, grp, label, angle, null, "03"); out.push(...r); log[naf] = r.length; } catch (e) { console.error(naf, e.message); }
  }
  const uniq = [...new Map(out.map(o => [o.id, o])).values()].sort((a, b) => b.prio - a.prio || (a.km ?? 999) - (b.km ?? 999));
  console.log("Pistes :", uniq.length, JSON.stringify(log));
  if (uniq.length < 50) throw new Error("Liste anormalement courte (" + uniq.length + "), fichier non remplacé.");
  await writeFile(new URL("../docs/pistes.json", import.meta.url), JSON.stringify({ maj: NOW.toISOString(), groupes: Object.fromEntries(Object.entries(GROUPES).map(([k, v]) => [k, v.label])), compte: log, pistes: uniq }));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e); process.exit(1); });
