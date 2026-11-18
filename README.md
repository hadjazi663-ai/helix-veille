# Helix Veille · robot d'alertes

Robot de veille des appels d'offres de sécurité et de gardiennage dans le Var, pour **Helix Sécurité** (Brignoles).

## Ce qu'il fait

Toutes les 15 minutes, jour et nuit, GitHub lance `scripts/veille.mjs`, qui :

1. lit le **BOAMP** (journal officiel des marchés publics) et le **TED** (journal officiel européen) ;
2. garde uniquement les consultations de sécurité du Var : gardiennage, surveillance, sûreté, événementiel, SSIAP ;
3. envoie une **notification ntfy** sur les téléphones pour chaque nouvelle offre ;
4. enregistre les offres connues dans `data/offres.json`.

L'application **Helix Veille** (page Claude, avec sa base de données) relit `data/offres.json` grâce à une tâche planifiée Claude. On y décide d'accepter ou de rejeter, on y prépare le message et on suit les étapes jusqu'au dépôt.

## Réglages

- **Settings, puis Secrets and variables, puis Actions :**
  - le secret `NTFY_TOPIC` contient le sujet ntfy privé ;
  - la variable `APP_URL` contient l'adresse de l'application Helix Veille.
- **Mots-clés, distances depuis Brignoles, classement :** `lib/boamp.js`.

## Vérifier que le robot tourne

Ouvrez l'onglet **Actions** : chaque passage apparaît avec une coche verte. Le bouton **Run workflow** lance un passage immédiat.

Le fichier `.github/workflows/keepalive.yml` fait un petit commit chaque mois. Sans lui, GitHub mettrait en pause les tâches planifiées d'un dépôt inactif depuis 60 jours.
