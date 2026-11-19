// plaques.js — plaques de présentation Helix Sécurité, une par catégorie.
// Dessinées à la volée (canvas 1200 × 800) : toujours nettes, aucune image à héberger.
// Utilisé par l'application (fiche de message : copier / télécharger) et par plaque.html (lien envoyé dans les mails).

export const CONTACTS = { jamael: "07 57 63 85 20", boumedien: "06 51 05 89 90", mail: "helixsecurite@gmail.com" };

export const PLAQUES = {
  gardiennage: { tag: "Gardiennage · Surveillance de sites", t1: "Vos locaux protégés,", t2: "jour et nuit.",
    pts: ["Gardiennage et rondes programmées", "Levée de doute sur alarme", "Remplacement d'agent en urgence"] },
  incendie: { tag: "Sûreté · Sécurité incendie", t1: "Votre établissement", t2: "en sécurité, en règle.",
    pts: ["Agents SSIAP qualifiés", "Rondes et contrôle des accès", "Chaque incident tracé par écrit"] },
  evenementiel: { tag: "Sécurité événementielle", t1: "Votre événement,", t2: "sans fausse note.",
    pts: ["Contrôle d'accès et palpation", "Gestion des flux et des tensions", "Équipe ajustée à votre jauge"] },
  medico: { tag: "Établissements sociaux et médico-sociaux", t1: "Vos résidents protégés,", t2: "vos équipes sereines.",
    pts: ["Agents issus du secteur social", "Veille et rondes de nuit", "La médiation avant tout"] },
  hebergement: { tag: "CHRS · Hébergement d'urgence · Foyers", t1: "Des nuits calmes", t2: "dans votre structure.",
    pts: ["Veilleurs formés aux publics fragiles", "Gestion apaisée des tensions", "Renfort dès le soir même"] },
  enfance: { tag: "MECS · Foyers de l'enfance", t1: "Les enfants protégés,", t2: "vos équipes soutenues.",
    pts: ["Veille de nuit bienveillante", "Entrées et visites sécurisées", "Des agents référents, toujours les mêmes"] },
  sante: { tag: "Hôpitaux · Cliniques", t1: "Des urgences apaisées,", t2: "des accès maîtrisés.",
    pts: ["Agents de sécurité hospitaliers", "Rondes de nuit et SSIAP", "Désamorçage des situations tendues"] },
  handicap: { tag: "IME · MAS · FAM · Foyers de vie", t1: "Une présence rassurante,", t2: "de jour comme de nuit.",
    pts: ["Veilleurs attentifs et discrets", "Remplacement de vos veilleurs", "Rondes et sécurité incendie"] },
  agees: { tag: "EHPAD · Résidences autonomie", t1: "Vos résidents en sécurité,", t2: "vos nuits tranquilles.",
    pts: ["Rondes et veille de nuit", "Contrôle des visiteurs", "Remplacement en urgence"] },
  lycee: { tag: "Lycées · Internats", t1: "Des entrées maîtrisées,", t2: "un lycée serein.",
    pts: ["Contrôle d'accès (Vigipirate)", "Surveillance de nuit de l'internat", "Sécurité de vos événements"] },
  college: { tag: "Collèges", t1: "Des entrées sécurisées,", t2: "un collège serein.",
    pts: ["Contrôle d'accès aux heures d'entrée", "Sécurité des sorties et événements", "Agents discrets et bienveillants"] }
};

const GOLD = "#c99a5a", GOLD2 = "#e2bd82", INK = "#0d0b09", WHITE = "#f6f1ea", DIM = "rgba(246,241,234,.62)";
const SERIF = '"Playfair Display", Gelasio, Georgia, "Times New Roman", serif';
const SANS = 'Manrope, "DM Sans", "Segoe UI", system-ui, sans-serif';

let fontsReady = null;
export function loadFonts() {
  if (fontsReady) return fontsReady;
  if (typeof document !== "undefined" && !document.querySelector("link[data-plaque-fonts]")) {
    const l = document.createElement("link"); l.rel = "stylesheet"; l.dataset.plaqueFonts = "1";
    l.href = "https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=Manrope:wght@500;700;800&display=swap";
    document.head.appendChild(l);
  }
  fontsReady = Promise.race([
    Promise.all([`700 72px ${SERIF}`, `500 30px ${SANS}`, `800 24px ${SANS}`].map(f => document.fonts.load(f).catch(() => null))),
    new Promise(r => setTimeout(r, 2500))
  ]);
  return fontsReady;
}
let logoP = null;
function loadLogo(base) {
  if (!logoP) logoP = new Promise(res => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => res(i); i.onerror = () => res(null); i.src = (base || "") + "icons/icon-192.png"; });
  return logoP;
}

/** Dessine la plaque `key` sur un canvas 1200 × 800 et le renvoie. */
export async function drawPlaque(key, { base = "", canvas = null } = {}) {
  const p = PLAQUES[key] || PLAQUES.gardiennage;
  await loadFonts();
  const logo = await loadLogo(base);
  const W = 1200, H = 800;
  const c = canvas || document.createElement("canvas"); c.width = W; c.height = H;
  const x = c.getContext("2d");

  // Fond
  const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, "#17130f"); g.addColorStop(1, INK);
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  const halo = x.createRadialGradient(W * .92, H * .1, 10, W * .92, H * .1, 520); halo.addColorStop(0, "rgba(201,154,90,.20)"); halo.addColorStop(1, "rgba(201,154,90,0)");
  x.fillStyle = halo; x.fillRect(0, 0, W, H);
  x.strokeStyle = "rgba(201,154,90,.18)"; x.lineWidth = 2;
  for (let i = 0; i < 3; i++) { x.beginPath(); x.moveTo(W - 330 + i * 70, 0); x.lineTo(W + i * 70, 330); x.stroke(); }

  // Casque en filigrane à droite
  if (logo) {
    const k = logo.width / 192, S = 420, o = document.createElement("canvas"); o.width = o.height = S; const ox = o.getContext("2d");
    ox.drawImage(logo, 46 * k, 14 * k, 100 * k, 100 * k, 0, 0, S, S);
    ox.globalCompositeOperation = "destination-in";
    const m = ox.createRadialGradient(S / 2, S / 2, S * .12, S / 2, S / 2, S / 2); m.addColorStop(0, "rgba(0,0,0,1)"); m.addColorStop(1, "rgba(0,0,0,0)");
    ox.fillStyle = m; ox.fillRect(0, 0, S, S);
    x.save(); x.globalAlpha = .22; x.globalCompositeOperation = "lighten"; x.drawImage(o, 780, 150); x.restore();
  }

  // En-tête : logo + nom
  if (logo) { x.save(); x.beginPath(); x.arc(110, 104, 50, 0, Math.PI * 2); x.clip(); const k = logo.width / 192; x.drawImage(logo, 40 * k, 10 * k, 112 * k, 112 * k, 58, 52, 104, 104); x.restore(); }
  x.strokeStyle = GOLD; x.lineWidth = 2; x.beginPath(); x.arc(110, 104, 51, 0, Math.PI * 2); x.stroke();
  x.fillStyle = WHITE; x.font = `700 34px ${SERIF}`; x.textBaseline = "alphabetic";
  x.fillText("HELIX", 186, 100); const hw = x.measureText("HELIX ").width;
  x.fillStyle = GOLD2; x.fillText("SÉCURITÉ", 186 + hw, 100);
  x.fillStyle = DIM; x.font = `500 18px ${SANS}`; spaced(x, p.tag.toUpperCase(), 188, 132, 2.2);

  // Titre
  const fs = fit(x, [p.t1, p.t2], 74, 1060, SERIF);
  x.fillStyle = WHITE; x.font = `700 ${fs}px ${SERIF}`;
  x.fillText(p.t1, 60, 300);
  x.fillStyle = GOLD2; x.fillText(p.t2, 60, 300 + fs * 1.12);
  x.fillStyle = GOLD; x.fillRect(60, 300 + fs * 1.12 + 32, 90, 4);

  // Trois points
  x.font = `500 30px ${SANS}`;
  p.pts.forEach((t, i) => {
    const y = 520 + i * 58;
    x.fillStyle = GOLD; x.beginPath(); x.arc(76, y - 10, 15, 0, Math.PI * 2); x.fill();
    x.strokeStyle = INK; x.lineWidth = 3.5; x.lineCap = "round"; x.lineJoin = "round";
    x.beginPath(); x.moveTo(69, y - 10); x.lineTo(74, y - 4); x.lineTo(84, y - 16); x.stroke();
    x.fillStyle = WHITE; x.fillText(t, 106, y);
  });

  // Pied : contacts
  x.fillStyle = "rgba(201,154,90,.10)"; x.fillRect(0, 712, W, 88);
  x.fillStyle = GOLD; x.fillRect(0, 712, W, 2);
  x.textBaseline = "middle"; x.font = `800 22px ${SANS}`; x.fillStyle = GOLD2;
  x.fillText("Diagnostic gratuit", 60, 756);
  x.font = `500 22px ${SANS}`; x.fillStyle = WHITE;
  const line = `Jamael ${CONTACTS.jamael}   ·   Boumedien ${CONTACTS.boumedien}   ·   ${CONTACTS.mail}`;
  x.textAlign = "right"; x.fillText(line, W - 60, 756); x.textAlign = "left"; x.textBaseline = "alphabetic";
  return c;
}
function spaced(x, s, px, py, sp) { let cx = px; for (const ch of s) { x.fillText(ch, cx, py); cx += x.measureText(ch).width + sp; } }
function fit(x, lines, size, maxW, fam) {
  for (let s = size; s > 40; s -= 2) { x.font = `700 ${s}px ${fam}`; if (lines.every(l => x.measureText(l).width <= maxW)) return s; }
  return 40;
}
export async function plaqueBlob(key, opts) {
  const c = await drawPlaque(key, opts);
  return await new Promise(r => c.toBlob(r, "image/png"));
}
