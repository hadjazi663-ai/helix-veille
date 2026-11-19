// etablissements.mjs — construit docs/etablissements.json : les établissements du Var à démarcher
// (hébergement social, enfance, handicap, personnes âgées, santé, collèges et lycées).
// Sources officielles et publiques :
//  • FINESS (répertoire national des établissements sanitaires et sociaux), data.gouv.fr
//  • Annuaire de l'Éducation nationale, data.education.gouv.fr
// Lancé une fois par mois par GitHub Actions (et à la demande).
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const DEP = "83";
const FINESS_DATASET = "https://www.data.gouv.fr/api/1/datasets/53699569a3a729239d2046eb/";
const EDU = "https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/fr-en-annuaire-education/records";

// Brignoles (mairie) : latitude / longitude
const BRIGNOLES = { lat: 43.4058, lon: 6.0616 };
const ROUTE = 1.25; // la route est ~25 % plus longue que la ligne droite

// ---------- Groupes d'établissements (d'après le libellé de catégorie FINESS) ----------
export const GROUPS = {
  hebergement: { label: "Hébergement social · urgence", base: 55, angle: "Veille de nuit, sécurité des résidents et des équipes, gestion des tensions et des entrées. Interlocuteur : la direction de l'établissement ou l'association gestionnaire." },
  enfance: { label: "Enfance · MECS · foyers", base: 50, angle: "Veille de nuit, sécurisation des entrées, des sorties et des visites médiatisées. Interlocuteur : la direction ou l'association gestionnaire." },
  sante: { label: "Hôpitaux · cliniques", base: 45, angle: "Sécurité des urgences, rondes de nuit, contrôle d'accès, agents SSIAP. Interlocuteur : direction des achats ou services techniques. Les gros contrats passent par appel d'offres : se faire connaître avant." },
  handicap: { label: "Handicap (IME, MAS, FAM, foyers)", base: 40, angle: "Veille de nuit, remplacements de veilleurs, sécurité du site. Interlocuteur : la direction ou l'association gestionnaire." },
  agees: { label: "Personnes âgées (EHPAD)", base: 35, angle: "Rondes et gardiennage de nuit, remplacement des veilleurs, sécurité incendie. Interlocuteur : la direction de l'établissement." },
  lycee: { label: "Lycées", base: 35, angle: "Contrôle d'accès aux heures d'entrée (Vigipirate), sécurisation des événements (portes ouvertes, examens) et, s'il y a un internat, surveillance de nuit. Établissement public : la Région Sud gère les gros achats, le proviseur décide du ponctuel. Établissement privé : le chef d'établissement décide." },
  college: { label: "Collèges", base: 25, angle: "Contrôle d'accès, sécurisation des événements et, s'il y a un internat, surveillance de nuit. Établissement public : le Département du Var gère les gros achats. Établissement privé : le chef d'établissement décide." }
};

const SKIP = /centre de sant[ée]|m[ée]dico.?psycho|\bc\.?m\.?p\b|domicile|dialyse|laboratoire|pharmacie|ambulatoire|consultation|^service|\bservice\b|c\.?s\.?a\.?p\.?a|addictolog|planification|protection maternelle|action m[ée]dico.?sociale pr[ée]coce|\bcamsp\b|\bsessad\b|bureau|transfusion|lactarium|radioth[ée]rapie|centre de dialyse|cabinet|t[ée]l[ée]surveillance|appartement de coordination/i;
const RULES = [
  ["hebergement", /r[ée]insertion sociale|c\.?h\.?r\.?s|demandeurs d.asile|c\.?a\.?d\.?a|h[ée]bergement d.urgence|centre provisoire|jeunes travailleurs|r[ée]sidences? sociales?|pension de famille|maison relais|lits halte|lits d.accueil m[ée]dicalis|accueil de jour|h[ée]bergement social/i],
  ["enfance", /maison d.enfants|foyer de l.enfance|m[èe]re.?enfant|pouponni|lieux? de vie|village d.enfants|protection de l.enfance/i],
  ["agees", /personnes [âa]g[ée]es|e\.?h\.?p\.?a\.?d|r[ée]sidences? autonomie|petite unit[ée] de vie/i],
  ["handicap", /m[ée]dico.?[ée]ducati|i\.?m\.?e\b|th[ée]rapeutique,? [ée]ducati|i\.?t\.?e\.?p|accueil sp[ée]cialis|accueil m[ée]dicalis|foyer de vie|accueil non m[ée]dicalis|foyer d.h[ée]bergement|[ée]ducation motrice|polyhandicap|d[ée]ficien|handicap|autis/i],
  ["sante", /centre hospitalier|\bc\.?h\.?\b|h[ôo]pita|soins (pluridisciplinaires?|chirurgicaux|m[ée]dicaux)|[ée]tablissement de soins|maladies mentales|psychiatr|lutte contre le cancer|r[ée]adaptation|soins de suite|obst[ée]tri|clinique/i]
];
export function groupOf(lib) {
  if (!lib || SKIP.test(lib)) return null;
  for (const [g, re] of RULES) if (re.test(lib)) return g;
  return null;
}

// ---------- Distances ----------
const rad = d => d * Math.PI / 180;
export function kmFromLatLon(lat, lon) {
  if (!isFinite(lat) || !isFinite(lon)) return null;
  const dLat = rad(lat - BRIGNOLES.lat), dLon = rad(lon - BRIGNOLES.lon);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat)) * Math.cos(rad(BRIGNOLES.lat)) * Math.sin(dLon / 2) ** 2;
  return Math.round(6371 * 2 * Math.asin(Math.sqrt(a)) * ROUTE);
}
// Lambert-93 (coordonnées FINESS) -> latitude / longitude (formules IGN, inverse de la projection conique conforme)
export function lambert93ToLatLon(x, y) {
  if (!isFinite(x) || !isFinite(y) || !x || !y) return null;
  const n = 0.7256077650, c = 11754255.426, xs = 700000, ys = 12655612.050, e = 0.0818191910428158, lon0 = rad(3);
  const dx = x - xs, dy = y - ys;
  const R = Math.sqrt(dx * dx + dy * dy), g = Math.atan(dx / -dy);
  const lon = lon0 + g / n, L = -Math.log(Math.abs(R / c)) / n;
  let phi = 2 * Math.atan(Math.exp(L)) - Math.PI / 2;
  for (let i = 0; i < 12; i++) { const es = e * Math.sin(phi); phi = 2 * Math.atan(Math.pow((1 + es) / (1 - es), e / 2) * Math.exp(L)) - Math.PI / 2; }
  return { lat: phi * 180 / Math.PI, lon: lon * 180 / Math.PI };
}

// ---------- Mise en forme ----------
const fmtTel = t => { const d = String(t || "").replace(/\D/g, ""); return d.length === 10 ? d.replace(/(\d{2})(?=\d)/g, "$1 ").trim() : (t || ""); };
const TITLE_SMALL = new Set(["de", "du", "des", "la", "le", "les", "et", "d", "l", "à", "a", "en", "sur", "aux", "au"]);
export function nice(s) {
  s = String(s || "").trim().replace(/\s+/g, " ");
  if (!s || /[a-zà-ÿ]/.test(s)) return s;
  return s.toLowerCase().replace(/(^|[\s'’\-(])([a-zà-ÿ])/g, (m, p, ch, i) => p + ((i > 0 && TITLE_SMALL.has(s.toLowerCase().slice(i + p.length).split(/[\s'’\-]/)[0])) ? ch : ch.toUpperCase()))
    .replace(/\b(Ehpad|Chrs|Cada|Huda|Mecs|Ime|Itep|Mas|Fam|Esat|Ssr|Smr|Ch|Chs|Chu|Usld|Fjt|Ccas|Ufr)\b/g, w => w.toUpperCase());
}
function score(base, km) {
  let s = base + (km == null ? 10 : km <= 30 ? 30 : km <= 60 ? 20 : km <= 100 ? 10 : 0);
  return Math.max(5, Math.min(100, s));
}

// ---------- FINESS ----------
// structureet;nofinesset;nofinessej;rs;rslongue;complrs;compldistrib;numvoie;typvoie;voie;compvoie;lieuditbp;commune;departement;libdepartement;ligneacheminement;telephone;telecopie;categetab;libcategetab;categagretab;libcategagretab;siret;...
export function parseFiness(text) {
  const st = [], geo = {};
  for (const line of text.split("\n")) {
    if (line.startsWith("structureet;" + DEP)) st.push(line.split(";"));
    else if (line.startsWith("geolocalisation;" + DEP)) { const p = line.split(";"); geo[p[1]] = [+p[2], +p[3]]; }
  }
  const out = [];
  for (const p of st) {
    const lib = p[19] || "";
    const g = groupOf(lib);
    if (!g || p[13] !== DEP) continue;
    const acc = (p[15] || "").trim(), cp = (acc.match(/^\d{5}/) || [""])[0];
    const ville = nice(acc.replace(/^\d{5}\s*/, "").replace(/\s+CEDEX.*$/i, ""));
    const adresse = nice([p[7], p[8], p[9], p[10]].filter(Boolean).join(" "));
    const ll = geo[p[1]] ? lambert93ToLatLon(geo[p[1]][0], geo[p[1]][1]) : null;
    const km = ll ? kmFromLatLon(ll.lat, ll.lon) : null;
    const nom = nice(p[4] || p[3]);
    out.push({
      id: "et-" + p[1], kind: "etab", grp: g, type: lib.replace(/\s+/g, " ").trim(), titre: nom,
      acheteur: "", statut: "",
      adresse, cp, ville, km, tel: fmtTel(p[16]), email: "", web: "", internat: false,
      finess: p[1], siret: p[22] || "", prio: score(GROUPS[g].base, km), note: GROUPS[g].angle, cat: "medico"
    });
  }
  return out;
}
async function latestFinessUrl() {
  const d = await (await fetch(FINESS_DATASET)).json();
  const res = (d.resources || []).filter(r => /csv/i.test(r.format || "") && /g[ée]olocalis/i.test(r.title || ""));
  res.sort((a, b) => String(b.last_modified || "").localeCompare(String(a.last_modified || "")));
  if (!res.length) throw new Error("Fichier FINESS géolocalisé introuvable sur data.gouv.fr");
  return res[0].url;
}

// ---------- Collèges et lycées ----------
export function schoolRecord(r) {
  const lyc = /lyc/i.test(r.type_etablissement || "");
  const g = lyc ? "lycee" : "college";
  const internat = String(r.hebergement) === "1";
  const km = kmFromLatLon(+r.latitude, +r.longitude);
  const pub = /public/i.test(r.statut_public_prive || "");
  const base = GROUPS[g].base + (internat ? 15 : 0) + (pub ? 0 : 5);
  const type = [r.type_etablissement, (r.statut_public_prive || "").toLowerCase(), internat ? "avec internat" : ""].filter(Boolean).join(" ");
  return {
    id: "et-" + r.identifiant_de_l_etablissement, kind: "etab", grp: g, type: type.charAt(0).toUpperCase() + type.slice(1),
    titre: r.nom_etablissement, acheteur: pub ? (lyc ? "Région Sud (établissement public)" : "Département du Var (établissement public)") : "Établissement privé",
    statut: pub ? "public" : "privé", adresse: [r.adresse_1, r.adresse_2].filter(Boolean).join(", "), cp: r.code_postal || "",
    ville: r.nom_commune || "", km, tel: fmtTel(r.telephone), email: r.mail || "", web: r.web || "", internat,
    uai: r.identifiant_de_l_etablissement, siret: r.siren_siret || "", prio: score(base, km), note: GROUPS[g].angle, cat: "gardiennage"
  };
}
async function fetchSchools() {
  const where = encodeURIComponent(`code_departement="0${DEP}" AND type_etablissement in ("Collège","Lycée") AND etat="OUVERT"`);
  let all = [];
  for (let off = 0; off < 1000; off += 100) {
    const r = await fetch(`${EDU}?limit=100&offset=${off}&where=${where}`);
    if (!r.ok) throw new Error("Annuaire Éducation indisponible (" + r.status + ")");
    const j = await r.json();
    all = all.concat(j.results || []);
    if (!j.results || j.results.length < 100) break;
  }
  return all.map(schoolRecord);
}

async function main() {
  const url = await latestFinessUrl();
  console.log("FINESS :", url);
  const text = await (await fetch(url)).text();
  const finess = parseFiness(text);
  const schools = await fetchSchools();
  const all = [...finess, ...schools].sort((a, b) => b.prio - a.prio || (a.km ?? 999) - (b.km ?? 999));
  const count = {}; all.forEach(o => count[o.grp] = (count[o.grp] || 0) + 1);
  console.log("Établissements :", all.length, JSON.stringify(count));
  if (all.length < 100) throw new Error("Liste anormalement courte (" + all.length + "), fichier non remplacé.");
  const out = { maj: new Date().toISOString(), sources: { finess: url, education: EDU }, groupes: Object.fromEntries(Object.entries(GROUPS).map(([k, v]) => [k, v.label])), etablissements: all };
  await writeFile(new URL("../docs/etablissements.json", import.meta.url), JSON.stringify(out));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e); process.exit(1); });
