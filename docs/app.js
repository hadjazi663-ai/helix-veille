// Helix Veille — application principale
import { fetchOpenOffers, fetchNearby13, CATS, score, daysLeft, kmFrom } from "./boamp.js";

const CFG = window.HELIX_CONFIG || {};
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtMoney = n => n ? new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(n) + " €" : "";
const fmtDate = s => { if (!s) return ""; if (/^\d{4}-\d{2}$/.test(s)) { const [y, m] = s.split("-"); return new Date(+y, +m - 1, 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" }); } return new Date(s.length === 10 ? s + "T12:00:00" : s).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Paris" }); };
const fmtDT = s => new Date(s).toLocaleString("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });
const BOAMP = id => "https://www.boamp.fr/pages/avis/?q=idweb:" + id;

const DEFAULT_SETTINGS = {
  sig: "Jamael et Boumedien, dirigeants",
  c1: "Jamael : 07 57 63 85 20",
  c2: "Boumedien : 06 51 05 89 90",
  mail: "helixsecurite@gmail.com",
  site: "https://helixsecurite.fr",
  cnaps: "", siret: "", ntfy: ""
};
const topic = () => settings.ntfy || CFG.ntfyTopic || "";
const REASONS = ["Trop loin", "Trop gros pour nous", "Habilitation requise", "Pas notre métier", "Délai trop court", "Titulaire en place", "Autre"];

// ---------- État ----------
let live = [], liveAt = null, liveError = null, prospects = [], notes = {}, extra = [];
let etabs = [], etabMaj = null, etabGroups = {};
const FE = { q: "", grp: "all", internat: false, st: "todo", sort: "prio", limit: 60 };
const REASONS_ET = ["Déjà équipé", "Pas intéressé", "Trop loin", "Pas de besoin la nuit", "Fermé / introuvable", "Autre"];
let decisions = {}, settings = { ...DEFAULT_SETTINGS };
let tab = "ao", current = null, rejectReason = "", newIds = new Set();
const F = { q: "", cat: "all", st: "todo", sort: "score", showClosed: false };

// =====================================================================
//  STOCKAGE : Supabase (partagé) ou local (cet appareil)
// =====================================================================
const store = {
  sb: null, user: null, mode: "local",
  get configured() { return !!(CFG.supabaseUrl && CFG.supabaseAnonKey && window.supabase); },
  async init() {
    if (!this.configured) { this.loadLocal(); return true; }
    this.mode = "supabase";
    this.sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey);
    const { data } = await this.sb.auth.getSession();
    this.user = data.session?.user || null;
    return !!this.user;
  },
  async sendCode(email) {
    const { error } = await this.sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: location.href.split("#")[0] } });
    if (error) throw error;
  },
  async verifyCode(email, token) {
    const { data, error } = await this.sb.auth.verifyOtp({ email, token, type: "email" });
    if (error) throw error;
    this.user = data.user;
  },
  async logout() { await this.sb.auth.signOut(); location.reload(); },
  me() { if (!this.user) return ""; const e = (this.user.email || "").toLowerCase(); return (CFG.users || {})[e] || e.split("@")[0]; },
  loadLocal() {
    try { const j = JSON.parse(localStorage.getItem("helix-veille") || "{}"); decisions = j.decisions || {}; settings = { ...DEFAULT_SETTINGS, ...(j.settings || {}) }; } catch (e) { }
  },
  saveLocal() { try { localStorage.setItem("helix-veille", JSON.stringify({ decisions, settings })); } catch (e) { } },
  async loadAll() {
    if (this.mode === "local") return;
    const ok = await this.sb.rpc("est_membre");
    if (ok.data !== true) { const e = new Error("non autorisé"); e.code = "non_membre"; throw e; }
    const mb = await this.sb.from("membres").select("email,prenom");
    (mb.data || []).forEach(m => { CFG.users = CFG.users || {}; if (m.prenom) CFG.users[m.email.toLowerCase()] = m.prenom; });
    const { data, error } = await this.sb.from("decisions").select("*");
    if (error) throw error;
    decisions = Object.fromEntries((data || []).map(r => [r.offre_id, r]));
    const s = await this.sb.from("settings").select("data").eq("id", 1).maybeSingle();
    if (s.data?.data) settings = { ...DEFAULT_SETTINGS, ...s.data.data };
  },
  subscribe(onChange) {
    if (this.mode === "local") return;
    this.sb.channel("decisions-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "decisions" }, p => {
        if (p.eventType === "DELETE") { const { [p.old.offre_id]: _, ...rest } = decisions; decisions = rest; }
        else decisions = { ...decisions, [p.new.offre_id]: p.new };
        onChange();
      })
      .subscribe(st => setSync(st === "SUBSCRIBED" ? "on" : "warn", st === "SUBSCRIBED" ? "Partagé en direct" : "Reconnexion…"));
  },
  async save(rec) {
    rec.updated_at = new Date().toISOString();
    rec.updated_by = this.me() || rec.updated_by || "";
    decisions = { ...decisions, [rec.offre_id]: rec };
    if (this.mode === "local") return this.saveLocal();
    const { error } = await this.sb.from("decisions").upsert(rec);
    if (error) toast("Enregistrement impossible : " + error.message);
  },
  async remove(id) {
    const { [id]: _, ...rest } = decisions; decisions = rest;
    if (this.mode === "local") return this.saveLocal();
    const { error } = await this.sb.from("decisions").delete().eq("offre_id", id);
    if (error) toast("Suppression impossible : " + error.message);
  },
  async loadOffres() {
    if (this.mode === "local") { try { return JSON.parse(localStorage.getItem("helix-manual") || "[]"); } catch (e) { return []; } }
    const { data, error } = await this.sb.from("offres").select("data,source,first_seen");
    if (error) throw error;
    return (data || []).map(r => ({ ...r.data, source: r.data.source || r.source, first_seen: r.first_seen }));
  },
  subscribeOffres(onInsert) {
    if (this.mode === "local") return;
    this.sb.channel("offres-live")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "offres" }, p => onInsert({ ...p.new.data, source: p.new.data?.source || p.new.source, first_seen: p.new.first_seen }))
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "offres" }, p => { extra = extra.filter(o => o.id !== p.old.id); render(); })
      .subscribe();
  },
  async addManual(o) {
    if (this.mode === "local") { const l = await this.loadOffres(); l.push(o); try { localStorage.setItem("helix-manual", JSON.stringify(l)); } catch (e) { } return; }
    const { error } = await this.sb.from("offres").insert({ id: o.id, source: "manuel", data: o });
    if (error) throw error;
  },
  async removeManual(id) {
    if (this.mode === "local") { const l = (await this.loadOffres()).filter(o => o.id !== id); try { localStorage.setItem("helix-manual", JSON.stringify(l)); } catch (e) { } return; }
    const { error } = await this.sb.from("offres").delete().eq("id", id);
    if (error) throw error;
  },
  async saveSettings() {
    if (this.mode === "local") return this.saveLocal();
    const { error } = await this.sb.from("settings").upsert({ id: 1, data: settings });
    if (error) toast("Enregistrement impossible : " + error.message);
  }
};

function setSync(kind, txt) { const d = $("#syncDot"); d.className = "dot " + (kind || ""); $("#syncTxt").textContent = txt; }

// =====================================================================
//  DONNÉES
// =====================================================================
async function loadExtra() {
  try { extra = (await store.loadOffres()).map(o => ({ ...o, kind: o.kind || "ao" })); } catch (e) { console.warn(e); }
}
async function loadLive({ silent = false } = {}) {
  await loadExtra();
  try {
    const ROBOT = "https://raw.githubusercontent.com/helix-veille/helix-veille.github.io/main/data/offres.json";
    const [direct, near13, robot] = await Promise.all([
      fetchOpenOffers().catch(() => []),
      fetchNearby13().catch(() => []),
      fetch(ROBOT + "?t=" + Math.floor(Date.now() / 300000), { cache: "no-store" }).then(r => r.ok ? r.json() : { offres: {} }).catch(() => ({ offres: {} }))
    ]);
    const byId = new Map(Object.values(robot.offres || {}).filter(o => !o.limite || new Date(o.limite) > Date.now() - 864e5).map(o => [o.id, o]));
    direct.forEach(o => byId.set(o.id, { ...(byId.get(o.id) || {}), ...o }));
    near13.forEach(o => byId.set(o.id, { ...(byId.get(o.id) || {}), ...o }));
    const offers = [...byId.values()];
    if (!offers.length && !direct.length) throw new Error("Sources injoignables");
    offers.forEach(o => { const n = notes[o.id]; if (n) { if (n.note) o.note = n.note; if (!o.resume && n.resume) o.resume = n.resume; if (n.cat) o.cat = n.cat; if (n.hab) o.hab = true; if (!o.email && n.email) o.email = n.email; if (!o.tel && n.tel) o.tel = n.tel; if (n.km != null && o.km == null) o.km = n.km; } });
    const before = new Set([...live.map(o => o.id), ...extra.map(o => o.id)]);
    const fresh = live.length ? offers.filter(o => !before.has(o.id)) : [];
    live = offers; liveAt = new Date(); liveError = null;
    try { localStorage.setItem("helix-live", JSON.stringify({ at: liveAt, live })); } catch (e) { }
    markNew();
    if (fresh.filter(o => o.dep !== "13").length) notifyFresh(fresh.filter(o => o.dep !== "13"));
  } catch (e) {
    liveError = e.message || "BOAMP injoignable";
    if (!live.length) { try { const c = JSON.parse(localStorage.getItem("helix-live") || "{}"); live = c.live || []; liveAt = c.at ? new Date(c.at) : null; } catch (_) { } }
    if (!silent) toast("BOAMP injoignable : dernières données affichées");
  }
  render();
}
function markNew() {
  let seen;
  try { seen = JSON.parse(localStorage.getItem("helix-seen") || "null"); } catch (e) { seen = null; }
  const ids = [...live, ...extra].filter(o => o.kind === "ao").map(o => o.id);
  if (!seen) seen = ids; // premier lancement : rien n'est « nouveau »
  ids.forEach(id => { if (!seen.includes(id)) newIds.add(id); });
  [...live, ...extra].forEach(o => { if (o.kind === "ao" && o.parution && (Date.now() - new Date(o.parution)) / 864e5 <= 2) newIds.add(o.id); });
  try { localStorage.setItem("helix-seen", JSON.stringify([...new Set([...seen, ...ids])].slice(-500))); } catch (e) { }
}
function notifyFresh(fresh) {
  fresh.forEach(o => newIds.add(o.id));
  toast(fresh.length === 1 ? "Nouvel appel d'offres : " + fresh[0].titre : fresh.length + " nouveaux appels d'offres");
  if ("Notification" in window && Notification.permission === "granted") {
    fresh.forEach(o => { try { new Notification("Nouvel appel d'offres · " + (CATS[o.cat]?.label || ""), { body: o.titre + "\n" + o.acheteur, icon: "icons/icon-192.png", tag: o.id }); } catch (e) { } });
  }
}

function allOffers() {
  const map = new Map();
  etabs.forEach(o => map.set(o.id, o));
  prospects.forEach(o => map.set(o.id, o));
  extra.forEach(o => map.set(o.id, o));
  live.forEach(o => map.set(o.id, { ...(map.get(o.id) || {}), ...o }));
  Object.values(decisions).forEach(d => { if (d.offre && !map.has(d.offre_id)) map.set(d.offre_id, { ...d.offre, archived: !d.offre.manual }); });
  return [...map.values()];
}
const isClosed = o => { const d = daysLeft(o); return d !== null && d < 0; };
const statusOf = id => decisions[id]?.status || "todo";

// =====================================================================
//  MODÈLES DE MESSAGES
// =====================================================================
function coordBlock() {
  const s = settings;
  return ["Helix Sécurité · Sécurité privée · Brignoles (Var)", s.sig, [s.c1, s.c2].filter(Boolean).join(" · "), [s.mail, s.site].filter(Boolean).join(" · "),
    s.cnaps ? "Autorisation CNAPS : " + s.cnaps : "", s.siret ? "SIRET : " + s.siret : ""].filter(Boolean).join("\n");
}
function metier(o) {
  return o.cat === "evenementiel" ? "la sécurité événementielle (accueil filtré, présence discrète, missions ponctuelles et VIP)"
    : o.cat === "medico" ? "la sécurité des structures sociales et médico-sociales, avec des agents choisis pour leur calme et leur sens de l'écoute"
    : o.cat === "incendie" ? "la surveillance et la sûreté des établissements recevant du public"
    : "le gardiennage et la surveillance de sites, de jour comme de nuit";
}
const METHODE = "Notre méthode : analyser le besoin, échanger avec vous, choisir l'agent adapté au site, cadrer les procédures avant le lancement, puis suivre la prestation dans la durée. Nous savons aussi répondre aux besoins urgents (gardiennage dès le soir même, remplacement d'un agent, renfort ponctuel).";

const TEMPLATES = {
  contact: {
    label: "Prise de contact", for: "ao",
    when: "Dès que vous acceptez un appel d'offres : vous vous faites connaître de l'acheteur avant de déposer votre candidature.",
    build: o => ({
      subj: `Consultation « ${o.titre} » · Helix Sécurité (Brignoles)`,
      body: `Madame, Monsieur,

Nous avons pris connaissance de votre consultation « ${o.titre} » (avis BOAMP n° ${o.id}) et nous préparons notre candidature, que nous déposerons sur votre plateforme avant la date limite.

Helix Sécurité est une société de sécurité privée basée à Brignoles, spécialisée dans ${metier(o)}. Nous intervenons dans tout le Var.

${METHODE}

Nous restons à votre disposition pour une visite de site ou toute précision sur votre besoin.

Bien cordialement,

${coordBlock()}`
    })
  },
  visite: {
    label: "Demande de visite", for: "ao",
    when: "Quand le règlement de consultation prévoit une visite du site, ou pour mieux chiffrer votre offre.",
    build: o => ({
      subj: `Demande de visite de site · « ${o.titre} »`,
      body: `Madame, Monsieur,

Dans le cadre de votre consultation « ${o.titre} » (avis BOAMP n° ${o.id}), Helix Sécurité souhaiterait effectuer une visite des lieux afin d'adapter précisément son offre : configuration du site, points sensibles, horaires, public accueilli.

Pourriez-vous nous indiquer les créneaux possibles et la personne à contacter sur place ?

Nous sommes disponibles dès cette semaine.

Bien cordialement,

${coordBlock()}`
    })
  },
  question: {
    label: "Question sur le dossier", for: "ao",
    when: "Pour une précision sur le cahier des charges. Attention : beaucoup d'acheteurs exigent que les questions passent par la plateforme.",
    build: o => ({
      subj: `Question · consultation « ${o.titre} »`,
      body: `Madame, Monsieur,

Dans le cadre de votre consultation « ${o.titre} » (avis BOAMP n° ${o.id}), nous souhaiterions obtenir la précision suivante :

[Votre question : nombre d'agents par poste, horaires, qualification SSIAP exigée, matériel fourni, etc.]

Nous vous remercions par avance de votre retour.

Bien cordialement,

${coordBlock()}`
    })
  },
  presentation: {
    label: "Présentation d'Helix", for: "prospect",
    when: "Pour un acheteur qui a déjà eu besoin de gardiennage : vous demandez à être consulté la prochaine fois.",
    build: o => ({
      subj: `Présentation Helix Sécurité · ${CATS[o.cat]?.label || "Sécurité"} · ${o.acheteur}`,
      body: `Madame, Monsieur,

Nous avons vu que ${o.acheteur} fait appel à des prestations de sécurité (« ${o.titre} »). Nous souhaitons vous présenter Helix Sécurité, une société de sécurité privée basée à Brignoles, spécialisée dans ${metier(o)}.

Nous serions heureux d'être consultés lors de vos prochaines procédures : marchés à procédure adaptée, bons de commande, renforts ponctuels ou besoins urgents. Nous intervenons dans tout le Var.

${METHODE}

Pourriez-vous nous indiquer la date de fin du marché en cours, ou la personne à contacter pour figurer dans vos listes de consultation ?

Bien cordialement,

${coordBlock()}`
    })
  },
  soustraitance: {
    label: "Renforts au titulaire", for: "prospect",
    when: "Quand un concurrent a gagné le marché : vous lui proposez vos agents en renfort ou en sous-traitance. À envoyer à l'entreprise titulaire, pas à l'acheteur.",
    build: o => ({
      to: "",
      subj: `Proposition de renfort · ${o.acheteur}`,
      body: `Bonjour,

Vous êtes titulaire du marché « ${o.titre} » pour ${o.acheteur}${o.titulaire ? " (" + o.titulaire + ")" : ""}.

Helix Sécurité, société de sécurité privée basée à Brignoles, peut vous apporter des agents en renfort ou en sous-traitance sur ce marché : remplacements, pics d'activité, saison estivale, missions de nuit ou urgences.

Nos agents sont sélectionnés selon le site et encadrés directement par les dirigeants.

Pouvons-nous en parler lors d'un appel ?

Bien cordialement,

${coordBlock()}`
    })
  },
  etablissement: {
    label: "Présentation à l'établissement", for: "etab",
    when: "Premier contact avec la direction. Le plus efficace : envoyer ce message, puis appeler l'accueil deux ou trois jours après pour demander un rendez-vous.",
    build: o => ({
      subj: `Helix Sécurité · ${o.grp === "lycee" || o.grp === "college" ? "Sécurité de votre établissement" : "Veille de nuit et sécurité"} · ${o.titre}`,
      body: `Madame, Monsieur,

Helix Sécurité est une société de sécurité privée basée à Brignoles${o.km != null && o.km > 2 ? `, à environ ${o.km} km de ${o.ville}` : ""}. Nous accompagnons les établissements comme le vôtre en proposant ${offreEtab(o)}.

${METHODE}

Nous intervenons aussi bien de façon ponctuelle (remplacement, renfort, besoin urgent dès le soir même) que dans la durée.

Seriez-vous disponible pour un court échange téléphonique ou une rencontre sur place, afin de voir ensemble si nous pouvons vous être utiles ?

Bien cordialement,

${coordBlock()}`
    })
  },
  relance: {
    label: "Relance", for: "all",
    when: "Environ 15 jours après un premier message resté sans réponse.",
    build: o => ({
      subj: `Relance · Helix Sécurité · ${o.titre}`,
      body: `Madame, Monsieur,

Je me permets de revenir vers vous au sujet de notre précédent message concernant « ${o.titre} ».

Helix Sécurité reste à votre disposition pour échanger sur vos besoins en sécurité et en gardiennage, et pour une rencontre sur site si vous le souhaitez.

Bien cordialement,

${coordBlock()}`
    })
  }
};
const tplsFor = o => Object.entries(TEMPLATES).filter(([, t]) => t.for === "all" || t.for === o.kind);

const CHECK_AO = [
  ["E-mail de prise de contact envoyé", ""],
  ["Dossier de consultation (DCE) téléchargé", "Sur la plateforme indiquée, avec création d'un compte entreprise gratuit."],
  ["Visite de site faite (si demandée)", ""],
  ["Pièces administratives prêtes", "DC1, DC2 ou DUME, Kbis, attestations URSSAF et fiscale, assurance RC pro, autorisation CNAPS."],
  ["Mémoire technique et prix rédigés", "Méthode, moyens humains, encadrement, références, tarifs horaires."],
  ["Offre déposée sur la plateforme", "Avant la date limite : un dépôt en retard est refusé."]
];
const CHECK_PR = [
  ["E-mail de présentation envoyé", ""],
  ["Appel téléphonique au service achats", ""],
  ["Relance à 15 jours", ""],
  ["Rendez-vous ou inscription en liste de consultation", ""]
];
const checksFor = o => o.kind === "ao" ? CHECK_AO : CHECK_PR;
function statusFromChecks(o, cl) {
  const n = checksFor(o).length;
  if (cl[n - 1]) return "deposited";
  if (cl[0]) return "sent";
  return "accepted";
}
const STATUS_LABEL = { accepted: "Acceptée · message à envoyer", sent: "Message envoyé", deposited: null, rejected: "Rejetée" };
const statusLabel = (o, st) => st === "deposited" ? (o.kind === "ao" ? "Offre déposée" : "Rendez-vous obtenu") : STATUS_LABEL[st];

// =====================================================================
//  RENDU
// =====================================================================
function renderKpis() {
  const list = allOffers();
  const open = list.filter(o => o.kind === "ao" && o.dep !== "13" && !o.archived && !isClosed(o));
  const gard = list.filter(o => o.cat === "gardiennage" && !o.archived && !(o.kind === "ao" && isClosed(o))).length;
  const acc = Object.values(decisions).filter(d => d.status !== "rejected").length;
  $("#kpis").innerHTML = `
    <div class="kpi g"><b>${open.length}</b><span>appels d'offres ouverts</span></div>
    <div class="kpi"><b>${gard}</b><span>pistes gardiennage</span></div>
    <div class="kpi"><b>${list.filter(o => o.kind === "prospect").length}</b><span>acheteurs à démarcher</span></div>
    <div class="kpi g"><b>${acc}</b><span>offres en cours de réponse</span></div>`;
  $("#srcLine").textContent = liveError && !liveAt ? "BOAMP injoignable pour le moment." :
    "BOAMP en direct · mis à jour " + (liveAt ? liveAt.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "…") + (liveError ? " (hors ligne)" : "") + " · actualisation toutes les 10 min";
}
function renderTabs() {
  const list = allOffers();
  const nAo = list.filter(o => o.kind === "ao" && o.dep !== "13" && !o.archived && !isClosed(o) && statusOf(o.id) === "todo").length;
  const nNew = list.filter(o => o.kind === "ao" && o.dep !== "13" && newIds.has(o.id) && statusOf(o.id) === "todo").length;
  const n13 = list.filter(o => o.kind === "ao" && o.dep === "13" && !isClosed(o) && statusOf(o.id) === "todo").length;
  const nPr = list.filter(o => o.kind === "prospect" && statusOf(o.id) === "todo").length;
  const nSuivi = Object.values(decisions).filter(d => d.status !== "rejected").length;
  const nEt = etabs.filter(o => statusOf(o.id) === "todo").length;
  const T = [["ao", "Appels d'offres", nAo, nNew], ["ao13", "Bouches-du-Rhône", n13], ["prospect", "À démarcher", nPr], ["etab", "Établissements", nEt], ["suivi", "Suivi des réponses", nSuivi], ["messages", "Modèles de messages", null], ["sources", "Sources", null], ["recrutement", "Recrutement", null]];
  $("#tabs").innerHTML = T.map(([k, l, n, nn]) => `<button class="tab ${tab === k ? "on" : ""}" data-tab="${k}" type="button">${l}${n !== null ? `<span class="n ${nn ? "new" : ""}">${nn ? nn + " nouv." : n}</span>` : ""}</button>`).join("");
}
function filtersHtml(kind) {
  const cats = [["all", "Tout"], ["gardiennage", "Gardiennage"], ["evenementiel", "Événementiel"], ["medico", "Médico-social"], ["incendie", "SSIAP · Sûreté"]];
  return `<div class="filters">
    <input class="search" id="fq" placeholder="Rechercher une ville, un acheteur, un mot-clé…" value="${esc(F.q)}">
    ${cats.map(([k, l]) => `<button class="chip ${F.cat === k ? "on" : ""}" data-cat="${k}" type="button">${l}</button>`).join("")}
    <select class="sel" id="fst">
      <option value="todo" ${F.st === "todo" ? "selected" : ""}>À traiter</option>
      <option value="accepted" ${F.st === "accepted" ? "selected" : ""}>Acceptées</option>
      <option value="rejected" ${F.st === "rejected" ? "selected" : ""}>Rejetées</option>
      <option value="all" ${F.st === "all" ? "selected" : ""}>Toutes</option>
    </select>
    <select class="sel" id="fsort">
      <option value="score" ${F.sort === "score" ? "selected" : ""}>Tri : pertinence</option>
      <option value="date" ${F.sort === "date" ? "selected" : ""}>Tri : ${kind === "ao" ? "échéance" : "date"}</option>
      <option value="km" ${F.sort === "km" ? "selected" : ""}>Tri : distance</option>
    </select>
    ${kind === "ao" ? `<button class="chip ${F.showClosed ? "on" : ""}" id="fclosed" type="button">Clôturés suivis</button>` : ""}
  </div>`;
}
function progressHtml(o, d) {
  const cl = d?.checklist || []; const n = checksFor(o).length;
  return `<div class="progress" title="${cl.filter(Boolean).length}/${n} étapes">${Array.from({ length: n }, (_, i) => `<i class="${cl[i] ? "on" : ""}"></i>`).join("")}</div>`;
}
function cardHtml(o) {
  const c = CATS[o.cat] || { label: o.cat, cls: "" };
  const st = statusOf(o.id), d = decisions[o.id], sc = score(o);
  let dl;
  if (o.kind === "ao") {
    const left = daysLeft(o);
    if (left === null) dl = "";
    else if (left < 0) dl = `<span class="deadline over">Clôturé le ${fmtDT(o.limite)}</span>`;
    else if (left < 1) dl = `<span class="deadline urg">⏱ Clôture aujourd'hui · ${fmtDT(o.limite)}</span>`;
    else if (left < 7) dl = `<span class="deadline urg">⏱ ${Math.floor(left)} j restants · ${fmtDT(o.limite)}</span>`;
    else dl = `<span class="deadline ok">${Math.floor(left)} j restants · ${fmtDT(o.limite)}</span>`;
  } else dl = `<span class="deadline info">${esc(o.renouv || "")}</span>`;
  const meta = [
    `📍 ${esc(o.ville)}`, o.km != null ? (o.km === 0 ? "Sur place" : `≈ ${o.km} km de Brignoles`) : "",
    o.montant ? `💶 ${fmtMoney(o.montant)}` : "", o.duree ? `⏳ ${esc(o.duree)}` : "",
    o.parution ? `Publié ${fmtDate(o.parution)}` : "", o.titulaire ? `🏷 Titulaire : ${esc(o.titulaire)}` : ""
  ].filter(Boolean).map(x => `<span>${x}</span>`).join("");
  const act = st === "todo"
    ? `<button class="pill gold sm" data-accept="${o.id}" type="button">✓ Accepter</button><button class="pill sm" data-reject="${o.id}" type="button">✕ Rejeter</button>`
    : `<div style="flex:1;min-width:160px"><span class="status ${st}">${esc(statusLabel(o, st))}${st === "rejected" && d.reason ? " · " + esc(d.reason) : ""}</span> <span class="who">${esc(whoTxt(d))}</span>${st !== "rejected" ? progressHtml(o, d) : ""}</div>
       ${st !== "rejected" ? `<button class="pill sm gold" data-accept="${o.id}" type="button">Ouvrir la fiche</button>` : ""}<button class="pill sm" data-undo="${o.id}" type="button">Annuler</button>`;
  return `<article class="card st-${st}" id="card-${esc(o.id)}">
    <div class="c-top">
      <span class="tag ${c.cls}">${c.label}</span>
      ${newIds.has(o.id) && o.kind === "ao" ? `<span class="tag new">Nouveau</span>` : ""}
      ${o.hot ? `<span class="tag hot">Piste chaude</span>` : ""}${o.hab ? `<span class="tag hab">Habilitation</span>` : ""}
      <span class="score" title="Pertinence pour Helix">${sc}<span class="bar"><i style="width:${sc}%"></i></span></span>
    </div>
    <h3>${esc(o.titre)}</h3>
    <div class="buyer">${esc(o.acheteur)}</div>
    <div class="meta">${meta}</div>
    ${dl}
    ${o.resume ? `<p class="res">${esc(o.resume)}</p>` : ""}
    ${o.note ? `<div class="note">${esc(o.note)}</div>` : ""}
    <div class="links">${avisLink(o)}${o.plateforme ? `<a href="${esc(o.plateforme)}" target="_blank" rel="noopener">Plateforme / DCE ↗</a>` : ""}<span class="who">${esc(sourceLabel(o))}</span>${o.manual ? `<button class="linkbtn" data-delmanual="${esc(o.id)}" type="button">Supprimer</button>` : ""}</div>
    <div class="actions">${act}</div>
  </article>`;
}
function sourceLabel(o) {
  if (o.manual) return "Ajoutée à la main" + (o.origine ? " · " + o.origine : "");
  if (o.source === "ted") return "Source : TED (Europe)";
  if (o.kind === "ao") return "Source : BOAMP";
  return "";
}
function avisLink(o) {
  if (o.manual) return "";
  if (o.source === "ted") return `<a href="${esc(o.avis)}" target="_blank" rel="noopener">Avis TED ↗</a>`;
  return `<a href="${esc(o.avis || BOAMP(o.id))}" target="_blank" rel="noopener">Avis BOAMP ${esc(o.id)} ↗</a>`;
}
function whoTxt(d) {
  if (!d) return "";
  return [d.updated_by, d.updated_at ? new Date(d.updated_at).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) : ""].filter(Boolean).join(" · ");
}
function listView(kind) {
  const zone13 = kind === "ao13"; if (zone13) kind = "ao";
  let list = allOffers().filter(o => o.kind === kind && (kind !== "ao" || (zone13 ? o.dep === "13" : o.dep !== "13")));
  if (kind === "ao") list = list.filter(o => F.showClosed ? (isClosed(o) || o.archived) && statusOf(o.id) !== "todo" : !isClosed(o) && !o.archived);
  if (F.cat !== "all") list = list.filter(o => o.cat === F.cat);
  if (F.st !== "all" && !(kind === "ao" && F.showClosed)) list = list.filter(o => { const s = statusOf(o.id); return F.st === "accepted" ? (s !== "todo" && s !== "rejected") : s === F.st; });
  if (F.q.trim()) { const q = F.q.toLowerCase(); list = list.filter(o => [o.titre, o.acheteur, o.ville, o.resume, o.note, o.titulaire, o.id].join(" ").toLowerCase().includes(q)); }
  if (F.sort === "score") list.sort((a, b) => (newIds.has(b.id) - newIds.has(a.id)) || score(b) - score(a));
  else if (F.sort === "km") list.sort((a, b) => (a.km ?? 999) - (b.km ?? 999));
  else list.sort((a, b) => kind === "ao" ? new Date(a.limite) - new Date(b.limite) : (b.parution || "").localeCompare(a.parution || ""));
  const intro = zone13
    ? `<p class="intro">Les appels d'offres sécurité des Bouches-du-Rhône à moins de 70 km de Brignoles (Aix, Aubagne, Marseille, La Ciotat, Trets…). Ils sont listés à part et ne déclenchent pas de notification : à consulter de temps en temps.</p>`
    : kind === "ao"
    ? `<div class="introrow"><p class="intro">Les consultations sécurité ouvertes dans le Var : BOAMP en direct, TED (Europe) et offres ajoutées depuis les alertes des plateformes. Une notification arrive sur le téléphone dès qu'une nouvelle offre est publiée.</p><button class="pill gold sm" id="btnAdd" type="button">＋ Ajouter une offre</button></div>`
    : `<p class="intro">Des acheteurs varois qui ont déjà acheté du gardiennage ces 24 derniers mois. Accepter ouvre un message de présentation pour être consulté la prochaine fois, ou pour proposer des renforts au titulaire.</p>`;
  const emptyMsg = liveError && !live.length && kind === "ao" ? "Le BOAMP est injoignable pour le moment. Réessayez dans quelques minutes." : "Aucune offre ne correspond à ces filtres.";
  return filtersHtml(kind) + intro + (list.length ? `<div class="grid">${list.map(cardHtml).join("")}</div>` : `<div class="empty">${emptyMsg}</div>`);
}
// =====================================================================
//  ÉTABLISSEMENTS À DÉMARCHER (FINESS + annuaire de l'Éducation nationale)
// =====================================================================
const ETAB_ICON = { hebergement: "🏠", enfance: "🧒", sante: "🏥", handicap: "♿", agees: "👵", lycee: "🎓", college: "🏫" };
function etabView() {
  if (!etabs.length) return `<div class="empty">La liste des établissements est en cours de préparation. Revenez dans quelques minutes.</div>`;
  let list = etabs.slice();
  if (FE.grp !== "all") list = list.filter(o => o.grp === FE.grp);
  if (FE.internat) list = list.filter(o => o.internat);
  if (FE.st !== "all") list = list.filter(o => { const s = statusOf(o.id); return FE.st === "accepted" ? (s !== "todo" && s !== "rejected") : s === FE.st; });
  if (FE.q.trim()) { const q = FE.q.toLowerCase(); list = list.filter(o => [o.titre, o.type, o.ville, o.cp, o.adresse].join(" ").toLowerCase().includes(q)); }
  if (FE.sort === "km") list.sort((a, b) => (a.km ?? 999) - (b.km ?? 999));
  else if (FE.sort === "nom") list.sort((a, b) => a.titre.localeCompare(b.titre, "fr"));
  else list.sort((a, b) => b.prio - a.prio || (a.km ?? 999) - (b.km ?? 999));
  const count = g => etabs.filter(o => g === "all" || o.grp === g).length;
  const groups = [["all", "Tout"], ...Object.entries(etabGroups)];
  const shown = list.slice(0, FE.limit);
  return `<div class="filters">
    <input class="search" id="eq" placeholder="Rechercher un nom, une ville, un code postal…" value="${esc(FE.q)}">
    ${groups.map(([k, l]) => `<button class="chip ${FE.grp === k ? "on" : ""}" data-egrp="${k}" type="button">${k !== "all" ? (ETAB_ICON[k] || "") + " " : ""}${esc(l)} <small>${count(k)}</small></button>`).join("")}
    <button class="chip ${FE.internat ? "on" : ""}" id="eint" type="button">🛏 Avec internat</button>
    <select class="sel" id="est">
      <option value="todo" ${FE.st === "todo" ? "selected" : ""}>À contacter</option>
      <option value="accepted" ${FE.st === "accepted" ? "selected" : ""}>En cours</option>
      <option value="rejected" ${FE.st === "rejected" ? "selected" : ""}>Écartés</option>
      <option value="all" ${FE.st === "all" ? "selected" : ""}>Tous</option>
    </select>
    <select class="sel" id="esort">
      <option value="prio" ${FE.sort === "prio" ? "selected" : ""}>Tri : priorité</option>
      <option value="km" ${FE.sort === "km" ? "selected" : ""}>Tri : distance</option>
      <option value="nom" ${FE.sort === "nom" ? "selected" : ""}>Tri : nom</option>
    </select>
  </div>
  <p class="intro">Tous les établissements du Var qui peuvent avoir besoin d'une veille de nuit ou d'agents de sécurité : hébergement social et d'urgence (CHRS, demandeurs d'asile, foyers), enfance (MECS, foyers de l'enfance), handicap, EHPAD, hôpitaux et cliniques, collèges et lycées. Ils achètent souvent sur devis, sans appel d'offres : c'est en les contactant qu'on décroche ces contrats. <b>Contacter</b> ouvre un message de présentation adapté au type d'établissement.${etabMaj ? ` <span class="who">Sources officielles : répertoire FINESS et annuaire de l'Éducation nationale · mise à jour du ${fmtDate(etabMaj)}.</span>` : ""}</p>
  ${shown.length ? `<div class="grid">${shown.map(etabCard).join("")}</div>` : `<div class="empty">Aucun établissement ne correspond à ces filtres.</div>`}
  ${list.length > shown.length ? `<div style="text-align:center;margin:18px 0"><button class="pill" id="emore" type="button">Afficher plus (${list.length - shown.length} restants)</button></div>` : ""}`;
}
function etabCard(o) {
  const st = statusOf(o.id), d = decisions[o.id];
  const meta = [
    `📍 ${esc([o.cp, o.ville].filter(Boolean).join(" "))}`, o.km != null ? (o.km <= 2 ? "À Brignoles" : `≈ ${o.km} km de Brignoles`) : "",
    o.statut ? (o.statut === "public" ? "Public" : "Privé") : ""
  ].filter(Boolean).map(x => `<span>${x}</span>`).join("");
  const links = [
    o.tel ? `<a href="tel:${esc(o.tel.replace(/[^\d+]/g, ""))}">📞 ${esc(o.tel)}</a>` : "",
    o.email ? `<a href="mailto:${esc(o.email)}">✉ ${esc(o.email)}</a>` : "",
    o.web ? `<a href="${esc(o.web)}" target="_blank" rel="noopener">Site ↗</a>` : "",
    `<a href="https://www.google.com/maps/search/${encodeURIComponent([o.titre, o.adresse, o.cp, o.ville].filter(Boolean).join(" "))}" target="_blank" rel="noopener">Plan ↗</a>`
  ].filter(Boolean).join("");
  const act = st === "todo"
    ? `<button class="pill gold sm" data-accept="${esc(o.id)}" type="button">✓ Contacter</button><button class="pill sm" data-reject="${esc(o.id)}" type="button">✕ Écarter</button>`
    : `<div style="flex:1;min-width:160px"><span class="status ${st}">${esc(st === "rejected" ? "Écarté" : statusLabel(o, st))}${st === "rejected" && d.reason ? " · " + esc(d.reason) : ""}</span> <span class="who">${esc(whoTxt(d))}</span>${st !== "rejected" ? progressHtml(o, d) : ""}</div>
       ${st !== "rejected" ? `<button class="pill sm gold" data-accept="${esc(o.id)}" type="button">Ouvrir la fiche</button>` : ""}<button class="pill sm" data-undo="${esc(o.id)}" type="button">Annuler</button>`;
  return `<article class="card st-${st}" id="card-${esc(o.id)}">
    <div class="c-top">
      <span class="tag p3">${ETAB_ICON[o.grp] || ""} ${esc(etabGroups[o.grp] || o.grp)}</span>
      ${o.internat ? `<span class="tag hot">Internat</span>` : ""}
      <span class="score" title="Priorité pour Helix : type d'établissement et distance">${o.prio}<span class="bar"><i style="width:${o.prio}%"></i></span></span>
    </div>
    <h3>${esc(o.titre)}</h3>
    <div class="buyer">${esc(o.type)}</div>
    <div class="meta">${meta}</div>
    ${o.adresse ? `<p class="res">${esc(o.adresse)}</p>` : ""}
    <div class="note">${esc(o.note)}</div>
    <div class="links">${links}</div>
    <div class="actions">${act}</div>
  </article>`;
}
function offreEtab(o) {
  if (o.grp === "sante") return "des agents de sécurité pour vos urgences et vos accès, des rondes de nuit et, si besoin, des agents SSIAP";
  if (o.grp === "lycee" || o.grp === "college") return "le contrôle des accès aux heures d'entrée et de sortie, la sécurisation de vos événements (portes ouvertes, examens, soirées)" + (o.internat ? " et la surveillance de nuit de votre internat" : "");
  return "des veilleurs et agents de nuit choisis pour leur calme et leur sens de l'écoute face à un public fragile : présence rassurante, gestion des tensions, rondes et sécurité incendie, et remplacement de vos veilleurs en cas d'absence";
}
function suiviView() {
  const byId = new Map(allOffers().map(o => [o.id, o]));
  const rows = Object.values(decisions).map(d => ({ d, o: byId.get(d.offre_id) || d.offre })).filter(r => r.o)
    .sort((a, b) => (a.d.status === "rejected") - (b.d.status === "rejected") || (b.d.updated_at || "").localeCompare(a.d.updated_at || ""));
  if (!rows.length) return `<div class="empty">Aucune réponse en cours.<br>Acceptez une offre : vous la suivrez ici étape par étape, avec l'autre dirigeant.</div>`;
  return `<div class="panel" style="padding:8px 8px 4px;overflow-x:auto"><table class="t">
    <thead><tr><th>Statut</th><th>Offre</th><th>Échéance</th><th>Avancement</th><th>Par · le</th><th></th></tr></thead>
    <tbody>${rows.map(({ d, o }) => `<tr>
      <td><span class="status ${d.status}">${esc(statusLabel(o, d.status))}</span>${d.reason ? `<br><span class="who">${esc(d.reason)}</span>` : ""}</td>
      <td><b>${esc(o.titre)}</b><br><span class="who">${esc(o.acheteur || o.type || "")} · ${o.kind === "ao" ? "Appel d'offres" : o.kind === "etab" ? "Établissement" : "Prospect"}</span>${d.note ? `<br><span class="who">📝 ${esc(d.note)}</span>` : ""}</td>
      <td class="who">${o.limite ? fmtDT(o.limite) : esc(o.renouv || "")}</td>
      <td style="min-width:110px">${d.status !== "rejected" ? progressHtml(o, d) : ""}</td>
      <td class="who">${esc(whoTxt(d))}</td>
      <td style="white-space:nowrap">${d.status !== "rejected" ? `<button class="pill sm gold" data-accept="${esc(o.id)}" type="button">Fiche</button> ` : ""}<button class="pill sm" data-undo="${esc(o.id)}" type="button">Annuler</button></td>
    </tr>`).join("")}</tbody></table></div>`;
}
function messagesView() {
  const sampleAo = live.find(o => o.cat === "gardiennage") || live[0] || { id: "26-000000", kind: "ao", titre: "Gardiennage de sites communaux", acheteur: "Commune du Var", cat: "gardiennage" };
  const samplePr = prospects[0] || sampleAo;
  return `<p class="intro">Les messages proposés quand vous acceptez une offre. Ils se remplissent automatiquement avec le nom de l'acheteur, l'objet du marché et vos coordonnées (⚙ Coordonnées). Vous pouvez toujours les modifier avant l'envoi.</p>
  <div class="two">${["ao", "prospect"].map(kind => `<div class="panel">
    <div class="eyebrow">${kind === "ao" ? "Pour un appel d'offres ouvert" : "Pour un acheteur à démarcher"}</div>
    <h2>${kind === "ao" ? "Répondre à une consultation" : "Se faire connaître"}</h2>
    ${Object.entries(TEMPLATES).filter(([, t]) => t.for === kind || (t.for === "all" && kind === "prospect")).map(([k, t]) => {
      const e = t.build(kind === "ao" ? sampleAo : samplePr);
      return `<div class="tplcard"><div class="adhead"><b style="color:var(--white)">${esc(t.label)}</b><button class="pill sm" data-copy="tpl-${k}" type="button">Copier</button></div>
      <p style="margin:6px 0 0;font-size:13px">${esc(t.when)}</p>
      <div class="ad" id="tpl-${k}">Objet : ${esc(e.subj)}\n\n${esc(e.body)}</div></div>`;
    }).join("")}
  </div>`).join("")}</div>`;
}
const PLATFORMS = [
  ["PLACE · marchés de l'État", "https://www.marches-publics.gouv.fr", "Armées (Toulon), Justice, France Travail, CAF, Urssaf, universités. Créez un compte entreprise puis une « alerte » avec les mots-clés ci-dessous."],
  ["marches-securises.fr", "https://www.marches-securises.fr", "Très utilisée par les communes varoises (Draguignan, Sanary, Fréjus…). Menu « Veille » après inscription."],
  ["achatpublic.com", "https://www.achatpublic.com", "Hyères, Toulon Métropole Événements, nombreux établissements publics. Alertes e-mail gratuites."],
  ["marches-publics.info (AWS)", "https://www.marches-publics.info", "Toulon, La Garde, Ollioules, Le Pradet, Région Sud… Alertes gratuites par mots-clés et département."],
  ["e-marchespublics.com", "https://www.e-marchespublics.com", "Collectivités et syndicats intercommunaux. Alertes gratuites."],
  ["Marchés Online (Le Moniteur)", "https://www.marchesonline.com", "Rassemble les annonces légales des journaux, dont les petits marchés (moins de 90 000 €) absents du BOAMP."],
  ["France Marchés", "https://www.francemarches.com", "Agrégateur gratuit : profils d'acheteurs et presse régionale."],
  ["APProch · projets d'achats", "https://projets-achats.marches-publics.gouv.fr", "Pour être le premier : les acheteurs publics y annoncent leurs projets plusieurs mois avant la consultation."]
];
function sourcesView() {
  const mailTopic = topic() ? `ntfy-${topic()}@ntfy.sh` : "ntfy-VOTRE-SUJET@ntfy.sh";
  return `<div class="two">
    <div class="panel">
      <div class="eyebrow">Automatique · rien à faire</div>
      <h2>Lu par le robot toutes les 15 minutes</h2>
      <ul>
        <li><b>BOAMP</b> (journal officiel des marchés publics) : tous les marchés de plus de 90 000 € et de nombreux plus petits. Lu aussi en direct à chaque ouverture de l'application.</li>
        <li><b>TED</b> (journal officiel européen) : les marchés de plus de 221 000 €, avec l'e-mail de l'acheteur.</li>
      </ul>
      <p>Chaque nouvelle offre de sécurité dans le Var déclenche une notification ntfy sur les téléphones, avec un lien direct vers la fiche.</p>
      <h4>Mots-clés surveillés</h4>
      <p>gardiennage · agents de sécurité · surveillance humaine · sûreté · rondes · maîtres-chiens · SSIAP · sécurité événementielle · sécurité privée · contrôle d'accès · prévention incendie · levée de doute</p>
      <h4>Recevoir aussi les alertes des plateformes sur ntfy</h4>
      <ol class="howto-list">
        <li>Activez les alertes de chaque plateforme (liste à droite) vers <b>${esc(settings.mail || "helixsecurite@gmail.com")}</b>.</li>
        <li>Dans Gmail : ⚙ Paramètres → <i>Transfert et POP/IMAP</i> → <i>Ajouter une adresse de transfert</i> :
          <div class="topic"><code>${esc(mailTopic)}</code><button class="pill sm" data-copytext="${esc(mailTopic)}" type="button">Copier</button></div>
          Le code de confirmation de Gmail arrive directement en notification ntfy : recopiez-le dans Gmail.</li>
        <li>Créez un filtre Gmail : <i>De</i> = les adresses des plateformes (ex. <code>achatpublic.com OR marches-securises.fr OR marches-publics.info OR marches-publics.gouv.fr</code>) → <i>Transférer à</i> l'adresse ntfy ci-dessus.</li>
        <li>Quand une alerte arrive, ajoutez l'offre ici avec <b>＋ Ajouter une offre</b> pour la suivre comme les autres.</li>
      </ol>
    </div>
    <div class="panel">
      <div class="eyebrow">À activer une fois · gratuit</div>
      <h2>Alertes des plateformes d'acheteurs</h2>
      <p>Les petits marchés (moins de 90 000 €) sont souvent publiés uniquement sur la plateforme de l'acheteur, et toujours là en premier. Une alerte par plateforme suffit pour ne rien manquer.</p>
      <div class="chan">${PLATFORMS.map(([n, u, d]) => `<a href="${u}" target="_blank" rel="noopener"><span><b>${esc(n)}</b><br><small>${esc(d)}</small></span><small>↗</small></a>`).join("")}</div>
      <h4>Réglage conseillé pour chaque alerte</h4>
      <p>Département : <b>Var (83)</b> · Type : <b>Services</b> · Mots-clés : <b>gardiennage, sécurité, surveillance, sûreté, SSIAP, agents</b> · Envoi : <b>${esc(settings.mail || "helixsecurite@gmail.com")}</b>, tous les jours.</p>
    </div>
  </div>`;
}
function recruitView() {
  const s = settings, contact = [s.c1, s.c2, s.mail].filter(Boolean).join(" · ");
  const ads = [
    ["gard", "Agent de sécurité · gardiennage de sites (H/F)", `Agent de sécurité · Gardiennage de sites (H/F)\nBrignoles et Var · Jour / nuit\n\nHelix Sécurité est une société de sécurité privée basée à Brignoles. Le gardiennage est le cœur de notre activité : sites privés, locaux professionnels, chantiers, matériels et véhicules.\n\nCe qui nous distingue : un agent n'est jamais placé sur un site seulement parce qu'il est disponible. Nous choisissons la mission qui correspond à votre profil, et les dirigeants restent joignables et présents sur le terrain.\n\nVos missions\n• Surveillance et rondes de jour comme de nuit\n• Contrôle des accès, ouverture et fermeture de sites\n• Levée de doute et réaction aux déclenchements d'alarme\n• Rédaction des mains courantes et rapports\n\nProfil\n• Carte professionnelle CNAPS en cours de validité (obligatoire)\n• Ponctualité, présentation soignée, calme\n• SST et permis B appréciés\n\nPourquoi Helix\n• Missions claires, régulières et durables, plus des renforts ponctuels pour ceux qui le souhaitent\n• Une structure locale à taille humaine : vous connaissez vos dirigeants\n• Des affectations pensées selon votre profil\n\nCandidater : ${contact}\n${s.site}`],
    ["event", "Agent de sécurité · événementiel et accueil VIP (H/F)", `Agent de sécurité · Événementiel et accueil VIP (H/F)\nVar · Missions ponctuelles\n\nRéceptions, événements professionnels ou privés, domaines et lieux haut de gamme : Helix Sécurité recherche des agents capables d'assurer une présence visible sans être intrusive.\n\nVos missions\n• Accueil filtré et contrôle des accès\n• Sécurisation des invités et des lieux\n• Discrétion, tenue correcte et attitude professionnelle\n\nProfil\n• Carte professionnelle CNAPS en cours de validité (obligatoire)\n• Excellente présentation, aisance relationnelle\n• Disponibilité soirs et week-ends\n\nCandidater : ${contact}\n${s.site}`],
    ["medico", "Agent de sécurité · structures sociales et médico-sociales (H/F)", `Agent de sécurité · Structures sociales et médico-sociales (H/F)\nVar\n\nFoyers, lieux d'accueil, établissements de soin : chez Helix Sécurité, la mission ne se limite pas à surveiller. Elle demande écoute, patience, discrétion et la capacité à travailler avec les équipes sur place.\n\nVous venez du social, de la santé ou de l'animation et vous envisagez une reconversion ? Ce poste est fait pour les « professionnels de l'humain ».\n\nProfil\n• Carte professionnelle CNAPS en cours de validité (obligatoire pour exercer)\n• Calme face aux situations sensibles\n• Expérience auprès de publics fragiles appréciée\n\nCandidater : ${contact}\n${s.site}`]
  ];
  const reply = `Bonjour,\n\nMerci pour votre candidature chez Helix Sécurité.\n\nAvant toute affectation, nous prenons le temps d'échanger avec chaque agent : nous ne recrutons pas un profil « polyvalent » pour toutes les missions, nous cherchons le site qui vous correspond (gardiennage, événementiel ou médico-social).\n\nPouvez-vous nous envoyer :\n• votre CV\n• une copie de votre carte professionnelle CNAPS\n• vos disponibilités et votre secteur de mobilité\n\nNous vous rappelons rapidement pour un premier échange.\n\n${s.sig}\nHelix Sécurité · ${[s.c1, s.c2].filter(Boolean).join(" · ")}\n${s.mail} · ${s.site}`;
  return `<div class="two">
    <div class="panel">
      <div class="eyebrow">Vendre Helix aux demandeurs d'emploi</div>
      <h2>Ce qui fait venir les bons agents</h2>
      <p>Chaque offre gagnée demande des agents disponibles rapidement. Ces arguments viennent de votre site et parlent aux agents de sécurité :</p>
      <ul>
        <li><b>« Un bon agent au mauvais endroit reste un mauvais choix »</b> : l'agent est placé sur une mission qui correspond à son profil.</li>
        <li><b>Des dirigeants de terrain, joignables</b> : pas un numéro anonyme, mais Jamael et Boumedien.</li>
        <li><b>Des missions cadrées avant le lancement</b> : horaires, pauses, interlocuteurs, remplacements.</li>
        <li><b>Un ancrage local à Brignoles</b> : peu de trajets pour les agents de la Provence Verte.</li>
        <li><b>Une porte ouverte aux reconversions</b> du social et du médical.</li>
      </ul>
      <h4>Où publier (gratuit)</h4>
      <div class="chan">
        <a href="https://entreprise.francetravail.fr/" target="_blank" rel="noopener"><span>France Travail · espace recruteur</span><small>offre diffusée aux inscrits du Var ↗</small></a>
        <a href="https://employeurs.indeed.com/" target="_blank" rel="noopener"><span>Indeed · publication d'annonce</span><small>très consulté par les agents ↗</small></a>
        <a href="https://www.linkedin.com/talent/post-a-job" target="_blank" rel="noopener"><span>LinkedIn · offre d'emploi</span><small>chefs d'équipe, profils SSIAP ↗</small></a>
        <a href="https://www.maformation.fr/formations/domaine_securite_ville_brignoles-83170.html" target="_blank" rel="noopener"><span>Centres de formation sécurité de Brignoles</span><small>jeunes diplômés CQP APS / SSIAP ↗</small></a>
      </div>
      <h4>Réponse type à un candidat</h4>
      <div class="ad" id="replyTxt">${esc(reply)}</div>
      <button class="pill sm" data-copy="replyTxt" type="button">Copier la réponse</button>
    </div>
    <div class="panel">
      <div class="eyebrow">Annonces prêtes à publier</div>
      <h2>Trois profils, trois annonces</h2>
      <p>Comme sur votre site, chaque profil est orienté vers son métier. Vos coordonnées sont insérées automatiquement.</p>
      ${ads.map(([k, t, body]) => `<div style="margin-top:14px"><div class="adhead"><b style="color:var(--white);font-size:14.5px">${esc(t)}</b><button class="pill sm" data-copy="ad-${k}" type="button">Copier l'annonce</button></div><div class="ad" id="ad-${k}">${esc(body)}</div></div>`).join("")}
    </div>
  </div>`;
}
function render() {
  renderKpis(); renderTabs();
  const v = $("#view");
  if (tab === "ao" || tab === "ao13" || tab === "prospect") v.innerHTML = listView(tab);
  else if (tab === "etab") v.innerHTML = etabView();
  else if (tab === "suivi") v.innerHTML = suiviView();
  else if (tab === "messages") v.innerHTML = messagesView();
  else if (tab === "sources") v.innerHTML = sourcesView();
  else v.innerHTML = recruitView();
}

// =====================================================================
//  FICHE DE RÉPONSE
// =====================================================================
function findOffer(id) { return allOffers().find(o => o.id === id); }
function snapshot(o) { const { archived, ...rest } = o; return rest; }

async function openAccept(id) {
  const o = findOffer(id); if (!o) return;
  current = o;
  let d = decisions[id];
  if (!d || d.status === "rejected") {
    const tpl = o.kind === "ao" ? "contact" : o.kind === "etab" ? "etablissement" : "presentation";
    const e = TEMPLATES[tpl].build(o);
    d = { offre_id: id, status: "accepted", template: tpl, to_addr: [o.email, o.email2].filter(Boolean).join(", "), subject: e.subj, body: e.body, checklist: [], note: "", reason: "", offre: snapshot(o) };
    await store.save(d); render();
  }
  $("#aKind").textContent = o.kind === "ao" ? "Fiche de réponse · appel d'offres" : "Fiche de prospection";
  $("#aTitle").textContent = o.titre;
  $("#aSub").textContent = [o.acheteur, o.ville, o.limite ? "Date limite : " + fmtDT(o.limite) : ""].filter(Boolean).join(" · ");
  fillMessage(d);
  renderChecklist();
  $("#aNote").value = d.note || "";
  const links = [avisLink(o)].filter(Boolean);
  if (o.plateforme) links.push(`<a href="${esc(o.plateforme)}" target="_blank" rel="noopener">Plateforme / DCE ↗</a>`);
  $("#aLinks").innerHTML = links.join("");
  const tel = $("#aTel"); if (o.tel) { tel.hidden = false; tel.href = "tel:" + o.tel.replace(/[^\d+]/g, ""); tel.textContent = "📞 " + o.tel; } else tel.hidden = true;
  $("#ovAccept").classList.add("on");
}
function fillMessage(d) {
  const o = current;
  $("#aTpls").innerHTML = tplsFor(o).map(([k, t]) => `<button class="chip ${d.template === k ? "on" : ""}" data-tpl="${k}" type="button">${esc(t.label)}</button>`).join("");
  $("#aTplHint").textContent = TEMPLATES[d.template]?.when || "";
  $("#aTo").value = d.to_addr || ""; $("#aSubj").value = d.subject || ""; $("#aBody").value = d.body || "";
  const hints = [];
  if (!o.email && o.kind === "etab") hints.push("Pas d'e-mail public pour cet établissement : appelez l'accueil (" + (o.tel || "numéro sur le plan") + ") pour demander l'adresse de la direction, ou passez par le site de l'association gestionnaire.");
  else if (!o.email && d.template !== "soustraitance") hints.push("Aucun e-mail n'est publié pour cet acheteur : passez par la plateforme ou par l'accueil de la collectivité.");
  if (o.kind === "ao" && o.limite) hints.push("La réponse officielle se dépose sur la plateforme de l'acheteur avant le " + fmtDT(o.limite) + ".");
  $("#aHint").textContent = hints.join(" ");
  updateLinks();
}
function updateLinks() {
  const to = $("#aTo").value.replace(/\s+/g, ""), su = $("#aSubj").value, body = $("#aBody").value;
  $("#aGmail").href = "https://mail.google.com/mail/?view=cm&fs=1&to=" + encodeURIComponent(to) + "&su=" + encodeURIComponent(su) + "&body=" + encodeURIComponent(body);
  $("#aMail").href = "mailto:" + encodeURIComponent(to).replace(/%2C/g, ",").replace(/%40/g, "@") + "?subject=" + encodeURIComponent(su) + "&body=" + encodeURIComponent(body);
}
function renderChecklist() {
  const o = current, d = decisions[o.id] || {}, cl = d.checklist || [];
  $("#aChecklist").innerHTML = checksFor(o).map(([t, sub], i) => `<label class="${cl[i] ? "done" : ""}"><input type="checkbox" data-check="${i}" ${cl[i] ? "checked" : ""}><div><span>${esc(t)}</span>${sub ? `<small>${esc(sub)}</small>` : ""}</div></label>`).join("");
}
let saveTimer = null;
function saveDraftSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const d = decisions[current.id]; if (!d) return;
    store.save({ ...d, to_addr: $("#aTo").value, subject: $("#aSubj").value, body: $("#aBody").value, note: $("#aNote").value.trim() });
  }, 900);
}
async function markSentIfNeeded() {
  const d = decisions[current.id]; if (!d) return;
  const cl = [...(d.checklist || [])];
  if (!cl[0]) { cl[0] = true; await store.save({ ...d, to_addr: $("#aTo").value, subject: $("#aSubj").value, body: $("#aBody").value, checklist: cl, status: statusFromChecks(current, cl) }); renderChecklist(); render(); toast("Étape 1 cochée : message envoyé"); }
}

// =====================================================================
//  ALERTES (ntfy)
// =====================================================================
async function testPush() {
  if (!topic()) return toast("Indiquez d'abord le sujet ntfy dans ⚙ Coordonnées");
  try {
    const r = await fetch((CFG.ntfyServer || "https://ntfy.sh").replace(/\/$/, ""), {
      method: "POST",
      body: JSON.stringify({ topic: topic(), title: "Helix Veille · test", message: "Les alertes fonctionnent. Vous serez prévenu à chaque nouvel appel d'offres sécurité dans le Var.", tags: ["shield"], click: location.href.split("#")[0] })
    });
    toast(r.ok ? "Notification envoyée : regardez votre téléphone" : "Échec de l'envoi (" + r.status + ")");
  } catch (e) { toast("Échec de l'envoi : connexion impossible"); }
  if ("Notification" in window && Notification.permission === "default") { try { await Notification.requestPermission(); } catch (e) { } }
}

// =====================================================================
//  ÉVÉNEMENTS
// =====================================================================
function toast(t) { const el = $("#toast"); el.textContent = t; el.classList.add("on"); clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.remove("on"), 2600); }
async function copy(text) { try { await navigator.clipboard.writeText(text); toast("Copié"); } catch (e) { toast("Copie impossible : sélectionnez le texte"); } }
function closeAll() { document.querySelectorAll(".ov").forEach(o => o.classList.remove("on")); }

document.addEventListener("click", async e => {
  const t = e.target.closest("button, a");
  if (!t) { if (e.target.classList?.contains("ov")) closeAll(); return; }
  if (t.dataset.tab) { tab = t.dataset.tab; F.st = "todo"; F.showClosed = false; history.replaceState(null, "", "#" + tab); render(); return; }
  if (t.dataset.cat) { F.cat = t.dataset.cat; render(); return; }
  if (t.dataset.egrp) { FE.grp = t.dataset.egrp; FE.limit = 60; render(); return; }
  if (t.id === "eint") { FE.internat = !FE.internat; FE.limit = 60; render(); return; }
  if (t.id === "emore") { FE.limit += 60; render(); return; }
  if (t.id === "fclosed") { F.showClosed = !F.showClosed; render(); return; }
  if (t.dataset.accept) { openAccept(t.dataset.accept); return; }
  if (t.dataset.reject) {
    current = findOffer(t.dataset.reject); rejectReason = "";
    $("#rTitle").textContent = current.titre; $("#rNote").value = "";
    $("#rReasons").innerHTML = (current.kind === "etab" ? REASONS_ET : REASONS).map(r => `<button class="chip" data-reason="${esc(r)}" type="button">${esc(r)}</button>`).join("");
    $("#ovReject").classList.add("on"); return;
  }
  if (t.dataset.reason) { rejectReason = t.dataset.reason; document.querySelectorAll("[data-reason]").forEach(b => b.classList.toggle("on", b === t)); return; }
  if (t.id === "rOk") { await store.save({ offre_id: current.id, status: "rejected", reason: rejectReason, note: $("#rNote").value.trim(), checklist: [], offre: snapshot(current) }); closeAll(); render(); toast("Offre rejetée"); return; }
  if (t.dataset.undo) { if (!confirmUndo(t)) return; await store.remove(t.dataset.undo); render(); toast("Décision annulée"); return; }
  if (t.dataset.tpl) {
    const d = decisions[current.id]; const built = TEMPLATES[t.dataset.tpl].build(current);
    const nd = { ...d, template: t.dataset.tpl, subject: built.subj, body: built.body, to_addr: built.to !== undefined ? built.to : ([current.email, current.email2].filter(Boolean).join(", ")) };
    await store.save(nd); fillMessage(nd); return;
  }
  if (t.dataset.close !== undefined) { closeAll(); render(); return; }
  if (t.id === "aGmail" || t.id === "aMail") { setTimeout(markSentIfNeeded, 400); return; }
  if (t.id === "aCopy") { await copy(`À : ${$("#aTo").value}\nObjet : ${$("#aSubj").value}\n\n${$("#aBody").value}`); return; }
  if (t.dataset.copy) { copy(document.getElementById(t.dataset.copy).textContent); return; }
  if (t.id === "btnAlerts") { $("#topicName").textContent = topic() || "(à renseigner dans ⚙ Coordonnées)"; $("#ovAlerts").classList.add("on"); return; }
  if (t.id === "copyTopic") { copy(topic()); return; }
  if (t.id === "testPush") { testPush(); return; }
  if (t.id === "btnLogout") { store.logout(); return; }
  if (t.id === "btnAdd") { $("#addForm").reset(); $("#ovAdd").classList.add("on"); return; }
  if (t.dataset.copytext) { copy(t.dataset.copytext); return; }
  if (t.dataset.delmanual) {
    if (delArmed !== t.dataset.delmanual) { delArmed = t.dataset.delmanual; t.textContent = "Confirmer la suppression ?"; setTimeout(() => { delArmed = null; t.textContent = "Supprimer"; }, 3000); return; }
    delArmed = null;
    try { await store.removeManual(t.dataset.delmanual); await loadExtra(); render(); toast("Offre supprimée"); } catch (err) { toast("Suppression impossible : " + err.message); }
    return;
  }
  if (t.id === "btnInstall") { installPrompt?.prompt(); installPrompt = null; t.hidden = true; return; }
  if (t.id === "btnSettings") {
    const s = settings; $("#sSig").value = s.sig; $("#sC1").value = s.c1; $("#sC2").value = s.c2; $("#sMail").value = s.mail; $("#sSite").value = s.site; $("#sCnaps").value = s.cnaps; $("#sSiret").value = s.siret; $("#sNtfy").value = s.ntfy || "";
    $("#ovSettings").classList.add("on"); return;
  }
  if (t.id === "sSave") {
    settings = { sig: $("#sSig").value.trim(), c1: $("#sC1").value.trim(), c2: $("#sC2").value.trim(), mail: $("#sMail").value.trim(), site: $("#sSite").value.trim(), cnaps: $("#sCnaps").value.trim(), siret: $("#sSiret").value.trim(), ntfy: $("#sNtfy").value.trim() };
    await store.saveSettings(); closeAll(); render(); toast("Coordonnées enregistrées"); return;
  }
});
let undoArmed = null, delArmed = null;
function confirmUndo(btn) {
  if (undoArmed === btn.dataset.undo) { undoArmed = null; return true; }
  undoArmed = btn.dataset.undo; btn.textContent = "Confirmer ?"; setTimeout(() => { if (undoArmed === btn.dataset.undo) { undoArmed = null; btn.textContent = "Annuler"; } }, 3000);
  return false;
}
document.addEventListener("change", async e => {
  if (e.target.id === "fst") { F.st = e.target.value; render(); }
  if (e.target.id === "fsort") { F.sort = e.target.value; render(); }
  if (e.target.id === "est") { FE.st = e.target.value; FE.limit = 60; render(); }
  if (e.target.id === "esort") { FE.sort = e.target.value; render(); }
  if (e.target.dataset.check !== undefined) {
    const d = decisions[current.id]; const cl = [...(d.checklist || [])]; cl[+e.target.dataset.check] = e.target.checked;
    await store.save({ ...d, checklist: cl, status: statusFromChecks(current, cl) }); renderChecklist(); render();
  }
});
document.addEventListener("input", e => {
  if (e.target.id === "fq") { F.q = e.target.value; const p = e.target.selectionStart; render(); const f = $("#fq"); f.focus(); f.setSelectionRange(p, p); }
  if (e.target.id === "eq") { FE.q = e.target.value; FE.limit = 60; const p = e.target.selectionStart; render(); const f = $("#eq"); f.focus(); f.setSelectionRange(p, p); }
  if (["aTo", "aSubj", "aBody", "aNote"].includes(e.target.id)) { updateLinks(); saveDraftSoon(); }
});
document.addEventListener("keydown", e => { if (e.key === "Escape") { closeAll(); render(); } });

document.addEventListener("submit", async e => {
  if (e.target.id !== "addForm") return;
  e.preventDefault();
  const v = id => $(id).value.trim();
  const ville = v("#mVille") || "Var";
  const o = {
    id: "m-" + Date.now().toString(36), kind: "ao", source: "manuel", manual: true, origine: v("#mOrig"),
    cat: $("#mCat").value, titre: v("#mTitre"), acheteur: v("#mAch"), ville, dep: "83", km: kmFrom(ville),
    limite: v("#mLim") ? new Date(v("#mLim")).toISOString() : null, parution: new Date().toISOString().slice(0, 10),
    plateforme: v("#mUrl") || null, email: v("#mMail"), tel: "", resume: v("#mRes"), note: "", proc: ""
  };
  try { await store.addManual(o); await loadExtra(); closeAll(); newIds.add(o.id); tab = "ao"; render(); toast("Offre ajoutée"); }
  catch (err) { toast("Ajout impossible : " + err.message); }
});

// Lien direct depuis une notification : #offre-26-105779
function handleHash() {
  const h = decodeURIComponent(location.hash.slice(1));
  if (h.startsWith("offre-")) {
    const id = h.slice(6), o = findOffer(id); if (!o) return;
    tab = o.kind === "ao" ? (o.dep === "13" ? "ao13" : "ao") : o.kind === "etab" ? "etab" : "prospect"; F.st = "all"; F.cat = "all"; F.q = ""; FE.st = "all"; FE.q = o.kind === "etab" ? o.titre : FE.q; render();
    const el = document.getElementById("card-" + id); if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); el.classList.add("flash"); setTimeout(() => el.classList.remove("flash"), 2500); }
  } else if (["ao", "ao13", "prospect", "etab", "suivi", "messages", "sources", "recrutement"].includes(h)) { tab = h; render(); }
}
window.addEventListener("hashchange", handleHash);

// Installation sur l'écran d'accueil
let installPrompt = null;
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); installPrompt = e; $("#btnInstall").hidden = false; });
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => { });

// =====================================================================
//  DÉMARRAGE
// =====================================================================
async function start() {
  try { [prospects, notes] = await Promise.all([fetch("prospects.json").then(r => r.json()), fetch("notes.json").then(r => r.json())]); } catch (e) { }
  fetch("etablissements.json", { cache: "no-cache" }).then(r => r.ok ? r.json() : null).then(j => { if (!j) return; etabs = j.etablissements || []; etabMaj = j.maj; etabGroups = j.groupes || {}; render(); }).catch(() => { });
  try { await store.loadAll(); }
  catch (e) {
    if (e.code === "non_membre") {
      $("#appMain").hidden = true; $("#login").hidden = false;
      $("#loginForm").innerHTML = '<p class="err">L\'adresse ' + esc(store.user?.email || "") + " n'est pas autorisée. Demandez à un dirigeant de l'ajouter.</p><button class=\"pill wide\" type=\"button\" id=\"btnLogout2\">Changer d'adresse</button>";
      $("#btnLogout2").onclick = () => store.logout();
      return;
    }
    toast("Base partagée injoignable : " + (e.message || ""));
  }
  $("#login").hidden = true; $("#appMain").hidden = false;
  if (store.mode === "supabase") {
    $("#btnLogout").hidden = false; setSync("warn", "Connexion…"); store.subscribe(render);
    store.subscribeOffres(o => { if (extra.some(x => x.id === o.id) || live.some(x => x.id === o.id)) return; extra = [...extra, { ...o, kind: o.kind || "ao" }]; if (o.kind !== "prospect") notifyFresh([o]); render(); });
  }
  else setSync("", "Mode local (cet appareil)");
  render();
  await loadLive({ silent: true });
  handleHash();
  setInterval(() => loadLive({ silent: true }), 10 * 60 * 1000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && liveAt && Date.now() - liveAt > 5 * 60 * 1000) loadLive({ silent: true }); });
}
(async () => {
  const ok = await store.init();
  if (ok) return start();
  $("#login").hidden = false;
  let codeSent = false;
  $("#loginForm").addEventListener("submit", async e => {
    e.preventDefault(); $("#lErr").textContent = "";
    const email = $("#lEmail").value.trim();
    try {
      if (!codeSent) {
        await store.sendCode(email);
        codeSent = true; $("#codeBox").hidden = false; $("#lBtn").textContent = "Valider le code"; $("#lCode").focus();
        $("#lErr").textContent = "Code envoyé : regardez vos e-mails (et les indésirables).";
      } else { await store.verifyCode(email, $("#lCode").value.trim()); start(); }
    } catch (err) {
      const msg = String(err && (err.message || err.code) || "");
      $("#lErr").textContent = codeSent ? "Code incorrect ou expiré."
        : (err && err.status === 429) || /rate limit|too many|security purposes/i.test(msg) ? "Trop de mails de connexion envoyés cette heure-ci (limite du service gratuit). Réessayez dans une heure, ou utilisez le lien du dernier mail reçu."
        : /not allowed|signups/i.test(msg) ? "Cette adresse n'est pas autorisée." : "Envoi impossible : " + msg;
    }
  });
})();
