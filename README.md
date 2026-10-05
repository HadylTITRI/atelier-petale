# Atelier Pétale

Boutique en ligne de bouquets de fleurs personnalisables, avec livraison à domicile en Algérie (prix en dinars, paiement à la livraison).

- **Clients** : catalogue de bouquets, personnalisation (initiales, prénom, papillons, ruban, emballage cadeau), panier, formulaire de livraison, suivi de la commande avec son numéro.
- **Administration** (après connexion) : commandes reçues, changement de statut, gestion des bouquets.

Site : HTML, CSS et JavaScript (modules ES), sans framework. Serveur : **Node.js**, une seule dépendance (`mysql2`). Base de données : **MySQL**.

## Structure

```
atelier-petale/
├── index.html               L'application (toutes les pages)
├── css/style.css            Styles
├── js/                      Le site (navigateur)
│   ├── config.js            ← Réglages : nom, monnaie, livraison, options et prix des options
│   ├── options.js           Options de personnalisation : validation et calcul des prix
│   ├── app.js, shop.js, admin.js, cart.js, utils.js
│   └── store/
│       ├── index.js         Choisit la source de données selon config.js
│       ├── api-store.js     Parle au serveur (mode "api", la vraie boutique)
│       └── local-store.js   Mode démo dans le navigateur (mode "local")
├── server/                  Le serveur (Node.js)
│   ├── index.js             Démarrage (npm start)
│   ├── app.js               API et fichiers du site, sécurité
│   ├── validation.js        Vérification des commandes, prix recalculés côté serveur
│   ├── repo-mysql.js        Toutes les requêtes SQL
│   ├── auth.js, db.js, rate-limit.js, util.js
│   ├── db-init.js           npm run db:init : crée les tables
│   └── create-admin.js      npm run admin:create : crée le compte administrateur
├── database/schema.sql      Tables MySQL
├── test/                    Tests du serveur (npm test)
└── .env.example             Modèle de configuration
```

Le navigateur ne parle jamais à MySQL : il appelle le serveur, qui vérifie tout (champs, quantités, options) et **recalcule les prix lui-même**. Seuls `index.html`, `css/` et `js/` sont servis au public.

## 1. Tester sur votre PC

Il faut [Node.js](https://nodejs.org) 20 ou plus, et MySQL 8 (ou MariaDB 10.5+, par exemple via XAMPP).

1. Créez une base vide et un utilisateur (dans MySQL Workbench ou phpMyAdmin) :
   ```sql
   CREATE DATABASE atelier_petale CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   CREATE USER 'petale'@'localhost' IDENTIFIED BY 'un_mot_de_passe_solide';
   GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES ON atelier_petale.* TO 'petale'@'localhost';
   ```
   Avec XAMPP, vous pouvez garder `root` sans mot de passe pour tester.
2. Copiez `.env.example` en `.env` et remplissez `SESSION_SECRET` (commande de génération dans le fichier), `DB_USER`, `DB_PASSWORD`. Mettez en commentaire la ligne `DATABASE_URL` et décommentez les lignes `DB_*`.
3. Dans le dossier du projet :
   ```
   npm install
   npm run db:init
   npm run admin:create -- votre@email.dz
   npm start
   ```
4. Ouvrez http://localhost:3000. L'espace admin est le lien « Espace admin » en bas de page.

Sans serveur ni base, vous pouvez aussi essayer le **mode démo** : mettez `mode: "local"` dans `js/config.js` et ouvrez le dossier avec un petit serveur de fichiers (extension *Live Server* de VS Code). Connexion de démo : `admin@demo.fr` / `admin123`. Les données restent dans le navigateur : ne jamais utiliser ce mode en ligne.

## 2. Mettre en ligne gratuitement (Render + Aiven)

Offres gratuites vérifiées en octobre 2026, sans carte bancaire ; elles peuvent changer.

| Rôle | Service | Limites à connaître |
|------|---------|---------------------|
| Serveur Node.js | [Render](https://render.com), plan *Free* | s'endort après 15 min sans visite, le réveil prend environ une minute |
| Base MySQL | [Aiven](https://aiven.io/free-mysql-database), plan *Free* | 1 Go ; peut être éteinte après une longue inactivité |

### a) La base chez Aiven
1. Créez un compte, puis un service **MySQL** avec le plan **Free**, dans une région d'Europe (la plus proche de l'Algérie).
2. Quand le service est démarré, copiez le **Service URI** (il ressemble à `mysql://avnadmin:…@…aivencloud.com:12345/defaultdb?ssl-mode=REQUIRED`).
3. Sur votre PC, mettez cette adresse dans `.env` (`DATABASE_URL=…`) avec `SESSION_SECRET`, puis lancez :
   ```
   npm install
   npm run db:init
   npm run admin:create -- votre@email.dz
   ```
   Le premier crée les tables, le second crée votre compte administrateur (le mot de passe est demandé, 12 caractères minimum).

### b) Le serveur chez Render
1. Mettez le projet sur GitHub, puis dans Render : **New → Web Service**, choisissez le dépôt.
2. Réglages : Runtime **Node**, Build Command `npm install`, Start Command `npm start`, Instance Type **Free**, région **Frankfurt**.
3. Dans **Environment**, ajoutez :
   | Variable | Valeur |
   |----------|--------|
   | `NODE_ENV` | `production` |
   | `TRUST_PROXY` | `true` |
   | `SESSION_SECRET` | une longue phrase aléatoire (32 caractères minimum) |
   | `DATABASE_URL` | le Service URI d'Aiven |
4. Déployez. Le site est disponible sur `https://votre-service.onrender.com`, en HTTPS.

### c) Éviter l'endormissement (facultatif)
Créez un moniteur gratuit sur [UptimeRobot](https://uptimerobot.com) qui visite `https://votre-service.onrender.com/healthz?db=1` toutes les 5 minutes. Le serveur reste éveillé et la base reste active. Le plan gratuit de Render (750 heures par mois) couvre un service allumé en permanence.

### Avant d'ouvrir au public
- Remplacez les bouquets d'exemple depuis l'espace admin, et réglez les prix des options et les frais de livraison dans `js/config.js` (en centimes de dinar : 600 DA = `60000`).
- Vérifiez la réglementation algérienne applicable à la vente en ligne (commerce électronique, loi 18-05) et à la protection des données personnelles (loi 18-07) : mentions légales, conditions de vente, politique de confidentialité. Vous collectez des noms, téléphones et adresses.
- Sauvegardez régulièrement la base (export depuis Aiven ou `mysqldump`).

## Sécurité, en bref

- Mots de passe admin hachés (scrypt), session dans un cookie `HttpOnly` signé, 12 h.
- Prix, options et quantités recalculés et vérifiés côté serveur ; requêtes SQL paramétrées.
- Limitation des essais (connexion, commandes, suivi), protection contre les requêtes venues d'un autre site, en-têtes de sécurité (CSP).
- Le suivi par numéro de commande n'affiche ni téléphone ni adresse.

## Personnaliser

- **Nom, monnaie, livraison, créneaux, options et leurs prix** : `js/config.js`. Les options sont de quatre types : `text` (initiales, prénom), `quantity` (papillons), `choice` (couleur du ruban), `toggle` (case à cocher). Le serveur utilise le même fichier : un changement s'applique partout après redémarrage.
- **Couleurs et polices** : variables en haut de `css/style.css`.
- **Photos des bouquets** : collez le lien d'une image dans le formulaire produit.

## Tests

```
npm test
```
Teste le serveur (prix, options, refus des commandes invalides, accès admin, fichiers protégés, limitation des essais) avec une base en mémoire, sans MySQL.

## Pistes d'évolution

- Paiement en ligne (CIB / Edahabia via un prestataire agréé) en plus du paiement à la livraison.
- Version arabe du site.
- Notification (e-mail, Telegram ou WhatsApp) à l'atelier à chaque nouvelle commande.
- Envoi des photos directement depuis le tableau de bord.
