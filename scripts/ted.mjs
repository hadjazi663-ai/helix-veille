// ted.mjs — appels d'offres européens (TED) exécutés dans le Var (code NUTS FRL05)
import { categorize, kmFrom, guessCity } from "../lib/boamp.js";

const TED = "https://api.ted.europa.eu/v3/notices/search";
// Codes CPV des services de sécurité : gardiennage, surveillance, sécurité, patrouille, protection, enquête/sécurité
const CPV = ["79710000", "79711000", "79713000", "79714000", "79715000", "79716000", "79720000"];
const FIELDS = ["publication-number", "notice-title", "buyer-name", "buyer-city", "buyer-email", "deadline-receipt-tender-date-lot",
  "notice-type", "publication-date", "estimated-value-lot", "place-of-performance-city-lot"];

const first = v => Array.isArray(v) ? v[0] : v;
const lang = v => v ? (first(v.fra) || first(v.mul) || first(v.eng) || first(Object.values(v)[0])) : "";

export async function fetchTedOffers({ days = 120 } = {}) {
  const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10).replace(/-/g, "");
  const query = `place-of-performance IN (FRL05) AND classification-cpv IN (${CPV.join(" ")}) AND publication-date>=${since}`;
  const r = await fetch(TED, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, fields: FIELDS, limit: 100, page: 1 }) });
  if (!r.ok) throw new Error("TED indisponible (" + r.status + ")");
  const j = await r.json();
  const now = Date.now();
  return (j.notices || [])
    .filter(n => /^cn/.test(n["notice-type"] || ""))                       // avis de marché uniquement
    .map(n => {
      const dl = first(n["deadline-receipt-tender-date-lot"]);
      const limite = dl ? new Date(dl.slice(0, 10) + "T12:00:00+01:00").toISOString() : null;
      const titre = String(lang(n["notice-title"]) || "").replace(/^France\s*[–-]\s*[^–-]+[–-]\s*/, "").trim();
      const acheteur = lang(n["buyer-name"]) || "";
      const ville = first(n["place-of-performance-city-lot"]) || lang(n["buyer-city"]) || guessCity(acheteur) || "Var";
      const emails = (n["buyer-email"] || []).filter(e => !/aws-france|dematis|achatpublic|marches-securises/i.test(e));
      const id = "ted-" + n["publication-number"];
      return {
        id, kind: "ao", source: "ted", cat: categorize(titre + " " + acheteur), titre, acheteur,
        ville, dep: "83", km: kmFrom(ville) ?? kmFrom(guessCity(acheteur)), limite, parution: (n["publication-date"] || "").slice(0, 10),
        email: emails[0] || "", tel: "", plateforme: null,
        avis: `https://ted.europa.eu/fr/notice/-/detail/${n["publication-number"]}`,
        montant: +first(n["estimated-value-lot"]) || null, resume: "", proc: "Avis européen (TED)"
      };
    })
    .filter(o => !o.limite || new Date(o.limite) > now);
}

// Repère les doublons BOAMP / TED (même marché publié aux deux endroits)
export const key = o => (o.acheteur + " " + o.titre).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "").slice(0, 60);
export function isDuplicate(o, list) {
  const t = o.titre.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "").slice(0, 45);
  return list.some(b => b.titre.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "").includes(t));
}
