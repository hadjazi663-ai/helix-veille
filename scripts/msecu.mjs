// msecu.mjs — consultations publiques de marches-securises.fr (Var, services, sécurité)
// Lit la page publique de recherche (la même qu'un visiteur) pour quelques mots-clés, toutes les 15 min.
import { isRelevant, categorize, guessCity, kmFrom } from "../lib/boamp.js";

const BASE = "https://v2.marches-securises.fr/entreprise/";
const MOTS = ["sécurité", "gardiennage", "surveillance", "sûreté", "SSIAP", "veille de nuit"];
const MOIS = { janvier: 1, "février": 2, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, "août": 8, aout: 8, septembre: 9, octobre: 10, novembre: 11, "décembre": 12, decembre: 12 };

const decode = s => String(s || "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n));
const text = h => decode(String(h || "").replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const nice = t => { const l = t.replace(/[^A-Za-zÀ-ÿ]/g, ""); return l && l === l.toUpperCase() ? t.charAt(0) + t.slice(1).toLowerCase() : t; };
const pad = n => String(n).padStart(2, "0");

/** « jeudi 03 décembre 2026 - 12:00 » ou « 13 novembre 2026 » → ISO (heure de Paris, approximée en UTC+1). */
export function frDate(s) {
  const m = String(s || "").toLowerCase().match(/(\d{1,2})\s+([a-zéû]+)\s+(\d{4})(?:\s*-\s*(\d{1,2}):(\d{2}))?/);
  if (!m || !MOIS[m[2]]) return null;
  const iso = `${m[3]}-${pad(MOIS[m[2]])}-${pad(m[1])}T${pad(m[4] || 12)}:${m[5] || "00"}:00+01:00`;
  return new Date(iso).toISOString();
}

/** Découpe la page de résultats en consultations. */
export function parseListe(html) {
  const out = [];
  for (const part of String(html).split(/<tr class="tr_pa/).slice(1)) {
    const cle = (part.match(/cle_dce=([A-Za-z0-9]+)/) || [])[1];
    if (!cle) continue;
    const cell = cls => text((part.match(new RegExp(`<tr class="${cls}"[^>]*>([\\s\\S]*?)</tr>`)) || [])[1]);
    const td = cls => text((part.match(new RegExp(`<td[^>]*class="${cls}"[^>]*>([\\s\\S]*?)</td>`)) || [])[1]);
    const acheteur = text((part.match(/^[^>]*>\s*<td[^>]*>([\s\S]*?)<(?:a|\/td)/) || [])[1]).replace(/\s*\(\d{2,3}\)\s*$/, "");
    const objet = text((part.match(/class="objet"[^>]*>\s*<div[^>]*>([\s\S]*?)<\/div>/) || [])[1]);
    const ref = cell("tr_identifiant").replace(/^Référence\s*/i, "");
    const type = cell("tr_type"), proc = cell("tr_proc").replace(/^Procédure( \/ Nombre de lots)?\s*/i, "");
    const zone = cell("tr_dept").replace(/^Zone\(s\) géo\. de la prestation\s*/i, "");
    out.push({ cle, acheteur, objet, ref, type, proc, zone, parution: td("td_pub_date"), cloture: td("td_clot_date") });
  }
  return out;
}

export function toOffer(c, now = Date.now()) {
  const titre = nice(c.objet), acheteur = nice(c.acheteur);
  const ville = guessCity(acheteur) || guessCity(titre) || "Var";
  const limite = frDate(c.cloture), pub = frDate(c.parution);
  const url = `${BASE}?module=consultation|details&cle_dce=${c.cle}`;
  return {
    id: "ms-" + c.cle, kind: "ao", source: "msecu", cat: categorize(titre + " " + acheteur), titre, acheteur,
    ville, dep: "83", km: kmFrom(ville), limite, parution: pub ? pub.slice(0, 10) : null,
    proc: c.proc, email: "", tel: "", plateforme: url, avis: url, resume: c.ref ? "Référence " + c.ref : "", montant: null
  };
}

export async function fetchMsecuOffers(fetchImpl = fetch) {
  const seen = new Map(); let ok = 0;
  for (const mot of MOTS) {
    const url = `${BASE}?module=liste_consultations&presta=%3Bservices&r=${encodeURIComponent(mot)}&liste_dept=83&`;
    try {
      const r = await fetchImpl(url, { headers: { "User-Agent": "Mozilla/5.0 (Helix Veille ; veille appels d'offres Var)", "Accept-Language": "fr-FR" } });
      if (!r.ok) { console.warn("marches-securises", mot, r.status); continue; }
      ok++;
      for (const c of parseListe(await r.text())) if (!seen.has(c.cle)) seen.set(c.cle, c);
    } catch (e) { console.warn("marches-securises", mot, e.message); }
    await new Promise(r => setTimeout(r, 400));
  }
  if (!ok) throw new Error("marches-securises injoignable");
  const now = Date.now();
  return [...seen.values()]
    .filter(c => /\b83\b|Var/.test(c.zone || "83") && isRelevant({ objet: c.objet }))
    .map(c => toOffer(c, now))
    .filter(o => !o.limite || new Date(o.limite) > now);
}
