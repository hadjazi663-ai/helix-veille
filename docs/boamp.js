// boamp.js — lecture et classement des appels d'offres sécurité du Var (BOAMP).
// Module partagé : utilisé par l'application (navigateur) et par le robot d'alertes (Node 20).

export const API = "https://boamp-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/boamp/records";
export const DEP = "83";

const KEYWORDS = [
  "gardiennage", "agents de sécurité", "agent de sécurité", "sûreté", "maîtres-chiens", "maître-chien",
  "SSIAP", "rondes", "sécurité événementielle", "sécurité privée", "contrôle d'accès", "prévention incendie",
  "levée de doute", "surveillance humaine", "surveillance physique"
];

/** Requête ODSQL : Var + mots-clés sécurité (+ consultations encore ouvertes). */
export function buildWhere({ open = true } = {}) {
  const kw = [
    'descripteur_libelle="Gardiennage"', 'descripteur_libelle="Surveillance"', 'descripteur_libelle="Télésurveillance"',
    ...KEYWORDS.map(k => `search("${k.replace(/"/g, "")}")`)
  ].join(" OR ");
  let w = `code_departement="${DEP}" AND (${kw})`;
  if (open) w += " AND datelimitereponse >= now()";
  return w;
}

/** Récupère toutes les consultations ouvertes du Var (pagination incluse). */
export async function fetchOpenRaw(fetchImpl = fetch) {
  const where = encodeURIComponent(buildWhere({ open: true }));
  let all = [];
  for (let off = 0; off < 500; off += 100) {
    const r = await fetchImpl(`${API}?limit=100&offset=${off}&order_by=datelimitereponse%20asc&where=${where}`);
    if (!r.ok) throw new Error("BOAMP indisponible (" + r.status + ")");
    const j = await r.json();
    all = all.concat(j.results || []);
    if (!j.results || j.results.length < 100) break;
  }
  return all;
}

/** Récupère, filtre et met en forme les offres ouvertes pertinentes. */
export async function fetchOpenOffers(fetchImpl = fetch) {
  const raw = await fetchOpenRaw(fetchImpl);
  return raw.filter(isRelevant).map(normalize);
}

// ---------- Pertinence ----------
const STRONG = /gardiennage|agents? de (s[ée]curit[ée]|surveillance|pr[ée]vention)|s[ée]curit[ée] (priv[ée]e|[ée]v[ée]nementielle|des (sites|b[aâ]timents|locaux|biens|personnes))|ma[iî]tres?[- ]chiens?|cynophil|\brondes?\b|s[uû]ret[ée]|ssiap|pr[ée]vention (incendie|et (de )?s[ée]curit)|contr[ôo]le d.acc[eè]s|surveillance (humaine|physique|de sites?|des sites|des b[aâ]timents|des locaux|des parkings?|de nuit|et (de )?gardiennage)|lev[ée]e de doute|d[ée]clenchement d.alarme|accueil s[ée]curitaire|filtrage/i;
const EXCLUDE = /\btravaux\b|maintenance|fourniture|formation|vid[ée]o ?(protection|surveillance)|installation|\b[ée]tudes?\b|ma[iî]trise d.(oe|œ)uvre|assurance|nettoyage|v[êe]tements|\bEPI\b|d[ée]fibrillat|extincteur|logiciel|t[ée]l[ée]com|falaise|talus|versant|fourri[eè]re|coordonnateur|\bCSPS\b|bancaire|m[ée]decine|restauration/i;

export function isRelevant(r) {
  const objet = r.objet || "";
  const desc = r.descripteur_libelle || [];
  const human = desc.includes("Gardiennage") || STRONG.test(objet);
  if (!human) return false;
  if (EXCLUDE.test(objet) && !/gardiennage|agents? de s[ée]curit/i.test(objet)) return false;
  return true;
}

export function categorize(text) {
  const t = (text || "").toLowerCase().replace(/s[ée]curit[ée] sociale/g, "");
  if (/foyer|ehpad|h[ôo]pital|hospitalier|m[ée]dico|social|ccas|\bsoins?\b|sant[ée]|r[ée]sidences? sociales?|adoma|h[ée]bergement d.urgence|accueil de jour/.test(t)) return "medico";
  if (/[ée]v[ée]nement|manifestation|festiv|congr[eè]s|spectacle|concert|\bsalons?\b|\bf[eê]tes?\b|estival/.test(t)) return "evenementiel";
  if (/gardiennage|\brondes?\b|surveillance|alarme|agents? de s[ée]curit|ma[iî]tres?[- ]chiens?/.test(t)) return "gardiennage";
  if (/ssiap|incendie/.test(t)) return "incendie";
  return "gardiennage";
}

// ---------- Distances depuis Brignoles (route, km, approximatif) ----------
const KM = {
  "brignoles":0,"la celle":4,"le val":8,"camps-la-source":7,"tourves":10,"bras":15,"garéoult":15,"gareoult":15,"forcalqueiret":13,
  "carcès":15,"carces":15,"rocbaron":18,"correns":20,"saint-maximin-la-sainte-baume":20,"nans-les-pins":25,"barjols":25,"cotignac":25,
  "puget-ville":30,"le luc":30,"le luc-en-provence":30,"pourrières":30,"le cannet-des-maures":33,"signes":35,"cuers":35,"salernes":35,
  "saint-zacharie":35,"pierrefeu-du-var":40,"vidauban":40,"lorgues":40,"solliès-pont":45,"sollies-pont":45,"les arcs":45,"aups":45,
  "la valette-du-var":48,"la garde":50,"toulon":50,"trans-en-provence":50,"flayosc":50,"le beausset":52,"la crau":55,"le pradet":55,
  "draguignan":55,"le castellet":55,"le muy":55,"évenos":55,"evenos":55,"la seyne-sur-mer":58,"ollioules":58,"carqueiranne":60,
  "saint-cyr-sur-mer":60,"six-fours-les-plages":62,"hyères":65,"hyeres":65,"sanary-sur-mer":65,"bandol":65,"saint-mandrier-sur-mer":65,
  "roquebrune-sur-argens":65,"la londe-les-maures":70,"puget-sur-argens":70,"fréjus":75,"frejus":75,"sainte-maxime":75,"cogolin":75,
  "grimaud":75,"bormes-les-mimosas":75,"fayence":75,"le lavandou":80,"saint-raphaël":80,"saint-raphael":80,"comps-sur-artuby":80,
  "saint-tropez":85,"la croix-valmer":85,"ramatuelle":85
};
export function guessCity(text) {
  const t = (text || "").toLowerCase();
  const keys = Object.keys(KM).sort((a, b) => b.length - a.length);
  const k = keys.find(k => t.includes(k));
  return k ? titleCity(k) : null;
}
export function kmFrom(city) {
  if (!city) return null;
  const c = city.toLowerCase().replace(/\s+cedex.*$/, "").replace(/\s+\d+$/, "").trim();
  if (c in KM) return KM[c];
  const hit = Object.keys(KM).find(k => c.startsWith(k) || k.startsWith(c));
  return hit ? KM[hit] : null;
}

// ---------- Extraction des coordonnées dans le détail de l'avis ----------
const NOT_BUYER = /aws-france|avenue-web|dematis|achatpublic|marches-securises|marches-publics\.info|klekoon|juradm|tribunal|ted\.europa|boamp|legalis|maximilien|e-marchespublics|centraledesmarches|atexo|omnikles|pref\.gouv|paca\.gouv|^tj-|^greffe|^accueil-/i;
const PLATFORM = /achatpublic|marches-securises|marches-publics|dematis|maximilien|e-marchespublics|aws-|klekoon|atexo|\bmpe\b|marchespublics|plateforme|agysoft|var\.fr\/marches|omnikles/i;

function decode(s) {
  return String(s || "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/&amp;/g, "&").replace(/&quot;/g, '"');
}

export function details(r) {
  const s = typeof r.donnees === "string" ? r.donnees : JSON.stringify(r.donnees || {});
  const emails = [...new Set(s.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g) || [])].filter(e => !NOT_BUYER.test(e));
  const tels = [...s.matchAll(/"(?:cbc:Telephone|TEL)":\s*"([^"]+)"/g)].map(m => m[1].trim()).filter(t => !/480041260/.test(t.replace(/\s/g, "")));
  const urls = [...new Set(s.match(/https?:\/\/[^"\\\s<>]+/g) || [])].map(decode).filter(u => !/tribunal|juradm|boamp\.fr\/|ted\.europa|legifrance|eur-lex|europa\.eu/i.test(u));
  const plateforme = urls.find(u => PLATFORM.test(u)) || null;
  const places = [...s.matchAll(/"(?:cbc:PostalZone|CP)":\s*"(\d{5})"[\s\S]{0,200}?"(?:cbc:CityName|VILLE)":\s*"([^"]+)"/g)].map(m => ({ cp: m[1], ville: m[2] }));
  const placesRev = [...s.matchAll(/"(?:cbc:CityName|VILLE)":\s*"([^"]+)"[\s\S]{0,200}?"(?:cbc:PostalZone|CP)":\s*"(\d{5})"/g)].map(m => ({ cp: m[2], ville: m[1] }));
  const place = [...places, ...placesRev].find(p => p.cp.startsWith("83")) || null;
  const amt = (s.match(/"cbc:EstimatedOverallContractAmount"[^}]*?"#text":\s*"?([\d.]+)/) || [])[1];
  const du = s.match(/"cbc:DurationMeasure":\s*\{[^}]*?"@unitCode":\s*"(\w+)"[^}]*?"#text":\s*"(\d+)"/) || s.match(/"cbc:DurationMeasure":\s*\{[^}]*?"#text":\s*"(\d+)"[^}]*?"@unitCode":\s*"(\w+)"/);
  let duree = null;
  if (du) {
    const [unit, n] = /^\d+$/.test(du[1]) ? [du[2], du[1]] : [du[1], du[2]];
    duree = n + " " + ({ MONTH: "mois", DAY: "jours", YEAR: "an(s)", WEEK: "semaines" }[unit] || unit.toLowerCase());
  }
  const descs = [...s.matchAll(/"cbc:Description":\s*\{[^}]*?"#text":\s*"((?:[^"\\]|\\.){40,900})"/g)].map(m => decode(m[1]))
    .filter(d => !/L\.? ?2\d{3}|exclusion|tribunal|recours|r[èe]glement de la consultation|candidat|n.entre dans aucun|code de la commande publique/i.test(d));
  return {
    email: emails[0] || "", email2: emails[1] || "", tel: tels[0] || "",
    plateforme, ville: place ? place.ville : null, cp: place ? place.cp : null,
    montant: amt && +amt > 0 ? Math.round(+amt) : null, duree,
    resume: descs[0] ? descs[0].slice(0, 420) : ""
  };
}

function nice(t) {
  t = decode(t || "").trim();
  const letters = t.replace(/[^A-Za-zÀ-ÿ]/g, "");
  if (letters && letters === letters.toUpperCase()) t = t.charAt(0) + t.slice(1).toLowerCase();
  return t;
}
function titleCity(v) {
  return (v || "").toLowerCase().replace(/\s+cedex.*$/, "").replace(/(^|[\s-])([a-zàâçéèêëîïôûùüÿñ])/g, (m, a, b) => a + b.toUpperCase()).replace(/-(Sur|Les|La|Le|De|Du|En)-/g, s => s.toLowerCase());
}

export function normalize(r) {
  const d = details(r);
  let ville = d.ville ? titleCity(d.ville) : null;
  if (!ville) { const g = guessCity(r.nomacheteur); ville = g || "Var"; }
  const titre = nice(r.objet);
  return {
    id: r.idweb, kind: "ao", source: "boamp",
    cat: categorize(titre + " " + (r.nomacheteur || "") + " " + d.resume),
    titre, acheteur: nice(r.nomacheteur), ville, dep: DEP, km: kmFrom(ville),
    limite: r.datelimitereponse, parution: r.dateparution,
    proc: r.procedure_libelle || "", email: d.email, email2: d.email2, tel: d.tel,
    plateforme: d.plateforme, avis: r.url_avis, resume: d.resume, montant: d.montant, duree: d.duree,
    hab: /habilitation|classifi[ée]|confidentiel d[ée]fense|ISC\b/i.test(JSON.stringify(r.donnees || "").slice(0, 200000))
  };
}

// ---------- Score de pertinence pour Helix ----------
export const CATS = {
  gardiennage: { label: "Gardiennage", cls: "p1", base: 50 },
  evenementiel: { label: "Événementiel", cls: "p2", base: 40 },
  medico: { label: "Médico-social", cls: "p3", base: 40 },
  incendie: { label: "SSIAP · Sûreté", cls: "", base: 25 }
};
export function daysLeft(o, now = Date.now()) { return o.limite ? (new Date(o.limite) - now) / 864e5 : null; }
export function score(o, now = Date.now()) {
  let s = (CATS[o.cat] || { base: 20 }).base;
  const km = o.km ?? 60;
  s += km <= 30 ? 30 : km <= 70 ? 22 : km <= 100 ? 12 : 0;
  s += 5;
  if (o.hot) s += 15;
  if (o.hab) s -= 30;
  if (o.montant && o.montant > 2000000) s -= 10;
  if (o.titulaire) s -= 8;
  if (o.kind === "ao") { const d = daysLeft(o, now); if (d !== null) s += d >= 7 ? 10 : d >= 3 ? 4 : -15; }
  return Math.max(5, Math.min(100, Math.round(s)));
}
