# Atelier Pétale

Boutique en ligne de bouquets, nails et cadeaux, avec livraison à domicile.
Une seule application regroupe deux espaces :

- **Clients** : catalogue, panier, formulaire de livraison, validation, suivi de la commande.
- **Administration** (après connexion) : commandes reçues en direct, changement de statut, gestion des produits.

Aucune installation ni compilation : HTML, CSS et JavaScript (modules ES), sans framework.

## Structure

```
atelier-petale/
├── index.html               L'application (toutes les pages)
├── css/style.css            Styles
├── js/
│   ├── config.js            ← Réglages : nom, mode, frais de livraison, catégories
│   ├── app.js               Navigation et accès admin
│   ├── shop.js              Catalogue, panier, livraison, suivi client
│   ├── admin.js             Connexion, commandes, produits
│   ├── cart.js              Panier
│   ├── utils.js             Fonctions communes (formats, sécurité, visuels)
│   └── store/
│       ├── index.js         Choisit la source de données selon config.js
│       ├── local-store.js   Mode démo (navigateur)
│       └── supabase-store.js Mode production (Supabase)
└── supabase/schema.sql      Tables, règles de sécurité et fonctions
```

## Pages

| Adresse        | Qui la voit                                                  |
|----------------|--------------------------------------------------------------|
| `#boutique`    | Tout le monde                                                |
| `#commandes`   | Tout le monde (chaque client ne voit que ses commandes)      |
| `#admin`     postgre  | Formulaire de connexion, puis tableau de bord pour l'admin   |

Le lien « Espace admin » est en bas de page. L'onglet « Tableau de bord » n'apparaît qu'une fois connecté.

## 1. Tester en mode démo

Les modules JavaScript ne fonctionnent pas en double-cliquant sur le fichier : il faut un petit serveur local.

- **VS Code** : extension *Live Server*, clic droit sur `index.html` → *Open with Live Server*.
- **Terminal** : dans le dossier, `npx serve` (ou `python3 -m http.server 8000`), puis ouvrir l'adresse affichée.

Connexion admin de démo : `admin@demo.fr` / `admin123` (modifiable dans `js/config.js`).

Astuce : ouvrez la boutique dans un onglet et `#admin` dans un autre, passez une commande, elle apparaît aussitôt dans le tableau de bord.

> En mode démo, les données restent dans le navigateur : chaque visiteur a les siennes et il n'y a aucune vraie sécurité. Ce mode sert uniquement à tester.

## 2. Passer en production avec Supabase (gratuit pour démarrer)

1. Créez un projet sur [supabase.com](https://supabase.com).
2. **SQL Editor** → *New query* → collez le contenu de `supabase/schema.sql` → *Run*.
3. **Authentication → Users** → *Add user* : créez votre compte admin (e-mail + mot de passe).
4. Donnez-lui l'accès admin : dans le SQL Editor, exécutez
   ```sql
   insert into public.admins (user_id)
   select id from auth.users where email = 'votre@email.fr';
   ```
5. **Authentication → Sign In / Providers** : désactivez *Allow new users to sign up* (seule vous pourrez vous connecter).
6. **Project Settings → API** : copiez l'URL du projet et la clé `anon public`, puis dans `js/config.js` :
   ```js
   mode: "supabase",
   supabase: { url: "https://xxxx.supabase.co", anonKey: "eyJ..." },
   ```

La clé `anon` peut être publique : les règles de `schema.sql` empêchent les clients de lire les commandes des autres, de modifier les prix ou les produits.

## 3. Mettre en ligne

Le site est statique : déposez le dossier sur **Netlify** (glisser-déposer sur app.netlify.com/drop), **Vercel**, **Cloudflare Pages** ou **GitHub Pages**.

## Personnaliser

- **Nom, frais de livraison, catégories, créneaux** : `js/config.js`.
  Si vous changez les frais de livraison, changez aussi `delivery_fee` dans `supabase/schema.sql`.
  Si vous ajoutez une catégorie, ajoutez-la aussi dans la contrainte `category in (...)` de la table `products`.
- **Couleurs et polices** : variables en haut de `css/style.css`.
- **Photos produits** : collez le lien d'une image dans le formulaire produit (par exemple depuis Supabase Storage ou Cloudinary).

## Pistes d'évolution

- Paiement en ligne (Stripe Checkout).
- E-mail de confirmation au client et à l'atelier (Supabase Edge Function + Resend).
- Envoi des photos directement depuis le tableau de bord (Supabase Storage).
