# Atelier Pétale

Boutique en ligne de bouquets de fleurs personnalisables, avec livraison à domicile en Algérie (prix en dinars, paiement à la livraison).

- **Clients** : catalogue de bouquets, options à cocher (emballage cadeau, ruban…), panier, formulaire de livraison, suivi de la commande avec son numéro.
- **Administration** (après connexion) : commandes reçues, changement de statut, gestion des bouquets et des options.

Site : HTML, CSS et JavaScript (modules ES), sans framework. Serveur : **Node.js**, une seule dépendance (`mysql2`). Base de données : **MySQL**.

## Structure

```
atelier-petale/
├── index.html               L'application (toutes les pages)
├── css/style.css            Styles
├── js/                      Le site (navigateur)
│   ├── config.js            ← Réglages : nom, monnaie, livraison, créneaux
│   ├── options.js           Options des bouquets : vérification et calcul des prix (boutique et serveur)
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
│   ├── db-init.js           npm run db:init : crée les tables (et celles qui manquent sur une base existante)
│   └── create-admin.js      npm run admin:create : crée le compte administrateur
├── database/schema.sql      Tables MySQL
├── test/                    Tests du serveur (npm test)
└── .env.example             Modèle de configuration
```

Le navigateur ne parle jamais à MySQL : il appelle le serveur, qui vérifie tout (champs, quantités, options) et **recalcule les prix lui-même** à partir de la base. Seuls `index.html`, `css/` et `js/` sont servis au public.

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
- Remplacez les bouquets et les options d'exemple depuis l'espace admin, et réglez les frais de livraison dans `js/config.js` (en centimes de dinar : 600 DA = `60000`).
- Vérifiez la réglementation algérienne applicable à la vente en ligne (commerce électronique, loi 18-05) et à la protection des données personnelles (loi 18-07) : mentions légales, conditions de vente, politique de confidentialité. Vous collectez des noms, téléphones et adresses.
- Sauvegardez régulièrement la base (export depuis Aiven ou `mysqldump`).

## Sécurité, en bref

- Mots de passe admin hachés (scrypt), session dans un cookie `HttpOnly` signé, 12 h.
- Prix, options et quantités recalculés et vérifiés côté serveur ; requêtes SQL paramétrées.
- Limitation des essais (connexion, commandes, suivi), protection contre les requêtes venues d'un autre site, en-têtes de sécurité (CSP).
- Le suivi par numéro de commande n'affiche ni téléphone ni adresse.

## Options des bouquets

Les options se gèrent dans l'espace admin, onglet **Options** : nom, ce que le client fait, prix en DA (0 = offerte), ordre d'affichage, proposée ou non. Quatre types :

| Type | Le client… | Exemple | Prix |
|---|---|---|---|
| Case à cocher | coche | Emballage cadeau | fixe |
| Texte à écrire | écrit un texte (longueur max réglable) | Initiales « AM », prénom | fixe s'il écrit quelque chose |
| Choix dans une liste | choisit une valeur (un choix par ligne) | Couleur du ruban | fixe s'il choisit |
| Quantité | indique un nombre (maximum réglable) | Papillons × 3 | prix d'une unité × nombre |

**Chaque bouquet propose ses propres options** : dans l'onglet **Produits**, cochez celles du bouquet. À la création d'une option, « Ajouter à tous les bouquets » évite de passer sur chaque produit.

- À la commande, le serveur relit en base les options du bouquet, vérifie ce que le client a rempli (longueur, choix, nombre) et **recalcule le prix**. Une option inconnue, désactivée ou non proposée pour ce bouquet est refusée. Le nom, la valeur saisie et le prix sont copiés dans la commande (`order_items.options`) : modifier ou supprimer une option ensuite ne change pas les commandes passées.
- **Désactiver** une option la retire de la boutique tout en la gardant ; **supprimer** l'efface et la retire des bouquets.

**Base déjà en service ?** Relancez l'initialisation, sans risque pour vos données :
```
node --env-file=.env server/db-init.js
```
Elle ajoute les colonnes et la table qui manquent (`options.type`, `choices`, `max_value`, table `product_options`). La première fois, toutes les options existantes sont proposées pour tous les bouquets, comme avant ; « Initiales sur le bouquet », « Prénom sur un ruban » et « Ruban satin » deviennent des champs à remplir.

API : `GET /api/options` (public, options actives) ; `GET /api/products` renvoie les `optionIds` de chaque bouquet ; avec connexion admin : `GET` et `POST /api/admin/options`, `PUT` et `DELETE /api/admin/options/:id`, `PATCH /api/admin/options/:id/active` avec `{ "active": true | false }`, et `optionIds` dans `POST`/`PUT /api/admin/products`.

## Personnaliser

- **Nom, monnaie, livraison, créneaux** : `js/config.js`. Le serveur utilise le même fichier : un changement s'applique partout après redémarrage.
- **Options et leurs prix** : espace admin, onglet Options (voir plus haut).
- **Couleurs et polices** : variables en haut de `css/style.css`.
- **Photos des bouquets** : collez le lien d'une image dans le formulaire produit.

## Tests

```
npm test
```
Teste le serveur (prix, options recalculées depuis la base, refus des options inconnues ou désactivées, gestion des options et des produits, accès admin, fichiers protégés, limitation des essais) avec une base en mémoire, sans MySQL. Vérifie aussi que `database/schema.sql` et `server/db-init.js` décrivent la même table `options`.

## Pistes d'évolution

- Paiement en ligne (CIB / Edahabia via un prestataire agréé) en plus du paiement à la livraison.
- Version arabe du site.
- Notification (e-mail, Telegram ou WhatsApp) à l'atelier à chaque nouvelle commande.
- Envoi des photos directement depuis le tableau de bord.
