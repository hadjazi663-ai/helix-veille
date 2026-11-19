// ====================================================================
//  RÉGLAGES DE L'APPLICATION HELIX VEILLE
//  À compléter une seule fois (voir le guide de mise en ligne, étape 3).
// ====================================================================
window.HELIX_CONFIG = {
  // Base de données partagée (Supabase → Project Settings → API)
  supabaseUrl: "https://ekekuwbbndgctawbgwau.supabase.co",
  supabaseAnonKey: "",    // ← coller ici la « Publishable key » (Supabase → Project Settings → API Keys)

  // Alertes sur téléphone (application ntfy)
  ntfyServer: "https://ntfy.sh",
  ntfyTopic: "",           // laissez vide : le sujet se saisit dans ⚙ Coordonnées (gardé privé)

  // Prénoms affichés à côté des décisions (e-mail de connexion → prénom)
  users: {
    // "jamael@exemple.fr": "Jamael",
    // "boumedien@exemple.fr": "Boumedien"
  }
};
