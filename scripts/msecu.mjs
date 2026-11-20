// msecu.mjs — consultations publiques de marches-securises.fr (Var, services, sécurité)
// Lit la page publique de recherche (la même qu'un visiteur) pour quelques mots-clés, toutes les 15 min.
import { isRelevant, categorize, guessCity, kmFrom } from "../lib/boamp.js";
import { execFileSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
  const precis = (c.mots || []).filter(m => m !== "sécurité");
  const titre = c.masque ? `Consultation « ${precis.join(" · ") || "sécurité"} » · intitulé à voir sur Marchés-sécurisés` : nice(c.objet);
  const acheteur = nice(c.acheteur);
  const ville = guessCity(acheteur) || guessCity(titre) || "Var";
  const limite = frDate(c.cloture), pub = frDate(c.parution);
  const url = `${BASE}?module=consultation|details&cle_dce=${c.cle}`;
  return {
    id: "ms-" + c.cle, kind: "ao", source: "msecu", masque: !!c.masque, cat: categorize(titre + " " + acheteur), titre, acheteur,
    ville, dep: "83", km: kmFrom(ville), limite, parution: pub ? pub.slice(0, 10) : null,
    proc: c.proc, email: "", tel: "", plateforme: url, avis: url, resume: c.ref ? "Référence " + c.ref : "", montant: null
  };
}

// ---------- Avis officiel (AAPC, PDF public) : e-mail, téléphone et intitulé de l'acheteur ----------
const NOT_BUYER = /marches-securises|atline|minefe|economie\.gouv|tribunal|juradm|boamp|europa|legifrance|cnaps|interieur\.gouv|gouv\.fr$/i;
export function parseAapc(text) {
  const t = String(text || "").replace(/\r/g, "").replace(/[ \t]+\n/g, "\n");
  const lines = t.split("\n").map(l => l.trim());
  const after = re => {                                   // valeur d'un champ « Libellé : valeur » (même ligne ou lignes suivantes)
    const i = lines.findIndex(l => re.test(l));
    if (i < 0) return "";
    const same = lines[i].replace(re, "").replace(/^\s*:\s*/, "").trim();
    if (same) return same;
    const out = [];
    for (let j = i + 1; j < lines.length && out.length < 4; j++) {
      const l = lines[j];
      if (!l) { if (out.length) break; else continue; }
      if (/^[^:]{3,80}:\s*$/.test(l) || /^Section \d/i.test(l) || /^Classification|^Type de march/i.test(l)) break;
      out.push(l);
    }
    return out.join(" ").replace(/\s+/g, " ").trim();
  };
  const contact = after(/^Nom du contact\s*:?/i);
  const mails = [...new Set([...(contact.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) || []), ...(t.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) || [])])]
    .map(m => m.replace(/\.$/, "")).filter(m => !NOT_BUYER.test(m));
  const tel = ((contact + "\n" + t).match(/T[ée]l(?:[ée]phone)?\s*:?\s*(\+?[\d .]{9,18}\d)/) || [])[1] || "";
  const intitule = after(/^(Intitul[ée] du march[ée]|Objet du march[ée]|Objet de la consultation)\s*:?/i);
  const resume = after(/^Description succin(c)?te du march[ée]\s*:?/i);
  return { email: mails[0] || "", email2: mails[1] || "", tel: tel.replace(/\s+/g, " ").trim(), intitule, resume };
}
export async function lireAapc(cle, fetchImpl = fetch) {
  const r = await fetchImpl(`${BASE}?module=script|dl_la_s&cle_dce=${cle}`, { headers: { "User-Agent": "Mozilla/5.0 (Helix Veille ; veille appels d'offres Var)" } });
  if (!r.ok || !/pdf/i.test(r.headers.get("content-type") || "")) return null;
  const f = join(tmpdir(), "aapc-" + cle + ".pdf");
  writeFileSync(f, Buffer.from(await r.arrayBuffer()));
  try { return parseAapc(execFileSync("pdftotext", ["-enc", "UTF-8", f, "-"], { encoding: "utf8", timeout: 20000 })); }
  catch (e) { console.warn("pdftotext :", e.message.split("\n")[0]); return null; }
  finally { try { unlinkSync(f); } catch (e) { } }
}

/** known : offres déjà connues (data/offres.json) → l'avis PDF n'est lu qu'une fois par consultation. */
export async function fetchMsecuOffers(fetchImpl = fetch, known = {}) {
  const seen = new Map(), mots = new Map(); let ok = 0;
  for (const mot of MOTS) {
    const url = `${BASE}?module=liste_consultations&presta=%3Bservices&r=${encodeURIComponent(mot)}&liste_dept=83&`;
    try {
      const r = await fetchImpl(url, { headers: { "User-Agent": "Mozilla/5.0 (Helix Veille ; veille appels d'offres Var)", "Accept-Language": "fr-FR" } });
      if (!r.ok) { console.warn("marches-securises", mot, r.status); continue; }
      ok++;
      const html = await r.text(), found = parseListe(html);
      console.log(`marches-securises « ${mot} » : ${found.length} résultat(s)`);
      for (const c of found) { if (!seen.has(c.cle)) seen.set(c.cle, c); mots.set(c.cle, [...(mots.get(c.cle) || []), mot]); }
    } catch (e) { console.warn("marches-securises", mot, e.message); }
    await new Promise(r => setTimeout(r, 400));
  }
  if (!ok) throw new Error("marches-securises injoignable");
  const now = Date.now();
  // Le site masque l'intitulé (« ## ») pour les requêtes venant de serveurs : on garde alors l'acheteur, la date
  // et le mot-clé de recherche, en ne retenant que les mots-clés précis (pas « sécurité » seul, trop large).
  const out = []; let lus = 0;
  for (const c0 of seen.values()) {
    const c = { ...c0, mots: mots.get(c0.cle) || [], masque: !c0.objet || /^#+$/.test(c0.objet.trim()) };
    if (!/\b83\b|Var/.test(c.zone || "83")) continue;
    const prev = known["ms-" + c.cle];
    let a = prev && prev.aapc ? prev.aapc : null;
    if (!a && lus < 8) { lus++; try { a = await lireAapc(c.cle, fetchImpl); } catch (e) { console.warn("AAPC", c.cle, e.message); } }
    if (a && a.intitule && c.masque) { c.objet = a.intitule; c.masque = false; }
    const pertinent = c.masque ? c.mots.some(m => m !== "sécurité") : isRelevant({ objet: c.objet + " " + (a?.resume || "") }) || isRelevant({ objet: c.objet });
    console.log(`  · ${c.acheteur} | ${c.objet.slice(0, 70)} | ${a ? (a.email || "pas d'e-mail") : "avis non lu"} | ${pertinent ? "retenu" : "écarté"}`);
    if (!pertinent) continue;
    const o = toOffer(c, now);
    if (a) Object.assign(o, { aapc: a, email: a.email, email2: a.email2, tel: a.tel, resume: (a.resume && a.resume !== a.intitule ? a.resume.slice(0, 420) : o.resume) });
    if (!o.limite || new Date(o.limite) > now) out.push(o);
  }
  return out;
}
