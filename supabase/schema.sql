-- ============================================================================
-- Atelier Pétale — base de données MySQL 8 (ou MariaDB 10.5+)
-- Exécution : MySQL Workbench, phpMyAdmin, ou en ligne de commande :
--   mysql -u root -p < schema.sql
-- ============================================================================

CREATE DATABASE IF NOT EXISTS atelier_petale
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE atelier_petale;

-- ---------- Produits --------------------------------------------------------

CREATE TABLE IF NOT EXISTS products (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name         VARCHAR(80)  NOT NULL,
  category     ENUM('bouquets') NOT NULL DEFAULT 'bouquets',
  price_cents  INT UNSIGNED NOT NULL,                 -- 3990 = 39,90 €
  description  VARCHAR(300) NOT NULL DEFAULT '',
  image_url    VARCHAR(500) NOT NULL DEFAULT '',
  active       BOOLEAN      NOT NULL DEFAULT TRUE,    -- visible dans la boutique
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_products_catalog (active, category, name),
  CONSTRAINT chk_products_price CHECK (price_cents > 0)
) ENGINE = InnoDB;

-- ---------- Commandes -------------------------------------------------------

CREATE TABLE IF NOT EXISTS orders (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  code             CHAR(9)      NOT NULL,             -- ex. AP-K7M2QX, donné au client
  status           ENUM('nouvelle', 'preparation', 'livraison', 'livree', 'annulee')
                   NOT NULL DEFAULT 'nouvelle',

  -- Client
  customer_name    VARCHAR(100) NOT NULL,
  customer_phone   VARCHAR(30)  NOT NULL,
  customer_email   VARCHAR(120) NOT NULL DEFAULT '',

  -- Livraison
  recipient        VARCHAR(100) NOT NULL DEFAULT '',  -- si c'est un cadeau
  street           VARCHAR(200) NOT NULL,
  zip              CHAR(5)      NOT NULL,
  city             VARCHAR(100) NOT NULL,
  address_details  VARCHAR(200) NOT NULL DEFAULT '',  -- étage, code, interphone
  delivery_date    DATE         NOT NULL,
  delivery_slot    VARCHAR(60)  NOT NULL,
  card_message     VARCHAR(200) NOT NULL DEFAULT '',
  notes            VARCHAR(300) NOT NULL DEFAULT '',

  -- Montants (en centimes)
  subtotal_cents   INT UNSIGNED NOT NULL,
  delivery_cents   INT UNSIGNED NOT NULL,
  total_cents      INT UNSIGNED NOT NULL,

  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_orders_code (code),
  KEY idx_orders_status (status, created_at),
  KEY idx_orders_delivery (delivery_date),
  CONSTRAINT chk_orders_zip   CHECK (zip REGEXP '^[0-9]{5}$'),
  CONSTRAINT chk_orders_total CHECK (total_cents = subtotal_cents + delivery_cents)
) ENGINE = InnoDB;

-- Articles d'une commande. Le nom, le prix et les options (initiales, papillons,
-- ruban…) sont copiés au moment de l'achat : si le produit change de prix ou est
-- supprimé, la commande reste exacte. Le prix d'une ligne est
-- (unit_price_cents + options_cents) × quantity.
CREATE TABLE IF NOT EXISTS order_items (
  id                INT UNSIGNED      NOT NULL AUTO_INCREMENT,
  order_id          INT UNSIGNED      NOT NULL,
  product_id        INT UNSIGNED      NULL,
  product_name      VARCHAR(80)       NOT NULL,
  unit_price_cents  INT UNSIGNED      NOT NULL,                 -- prix du bouquet seul
  options_cents     INT UNSIGNED      NOT NULL DEFAULT 0,       -- total des options, par bouquet
  options           JSON              NULL,                     -- ex. [{"id":"initiales","label":"Initiales","value":"AM","priceCents":350}]
  quantity          SMALLINT UNSIGNED NOT NULL,
  PRIMARY KEY (id),
  KEY idx_order_items_order (order_id),
  CONSTRAINT fk_order_items_order   FOREIGN KEY (order_id)   REFERENCES orders (id)   ON DELETE CASCADE,
  CONSTRAINT fk_order_items_product FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE SET NULL,
  CONSTRAINT chk_order_items_qty    CHECK (quantity BETWEEN 1 AND 99),
  CONSTRAINT chk_order_items_opts   CHECK (options IS NULL OR JSON_VALID(options))
) ENGINE = InnoDB;

-- ---------- Administrateurs -------------------------------------------------
-- Le mot de passe n'est jamais stocké en clair : uniquement son empreinte (bcrypt),
-- calculée par le serveur (PHP : password_hash(), Node.js : bcrypt.hash()).

CREATE TABLE IF NOT EXISTS admins (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  email          VARCHAR(190) NOT NULL,
  password_hash  VARCHAR(255) NOT NULL,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_admins_email (email)
) ENGINE = InnoDB;

-- ---------- Produits d'exemple (facultatif) ---------------------------------
-- Ne s'insèrent que si la table est vide.

INSERT INTO products (name, category, price_cents, description)
SELECT sample.name, sample.category, sample.price_cents, sample.description
FROM (
  SELECT 'Bouquet de pivoines' AS name, 'bouquets' AS category, 4590 AS price_cents,
         'Pivoines roses de saison et feuillage d''eucalyptus, environ 40 cm.' AS description
  UNION ALL SELECT 'Bouquet champêtre', 'bouquets', 3490, 'Fleurs des champs du moment, emballage kraft.'
  UNION ALL SELECT '12 roses rouges', 'bouquets', 5290, 'Douze roses rouges longues tiges, ruban satin.'
  UNION ALL SELECT 'Bouquet de tulipes', 'bouquets', 3190, 'Quinze tulipes assorties, papier kraft et ruban.'
  UNION ALL SELECT 'Bouquet pastel', 'bouquets', 3990, 'Roses, lisianthus et gypsophile dans des tons poudrés.'
) AS sample
WHERE NOT EXISTS (SELECT 1 FROM products);

-- ============================================================================
-- Requêtes utiles pour le tableau de bord
-- ============================================================================

-- Commandes à traiter, les plus récentes d'abord :
--   SELECT * FROM orders
--   WHERE status IN ('nouvelle', 'preparation', 'livraison')
--   ORDER BY created_at DESC;

-- Détail des articles d'une commande (options comprises) :
--   SELECT product_name, options, quantity,
--          (unit_price_cents + options_cents) * quantity AS line_total_cents
--   FROM order_items WHERE order_id = ?;

-- Livraisons du jour :
--   SELECT * FROM orders
--   WHERE delivery_date = CURDATE() AND status IN ('nouvelle', 'preparation', 'livraison');

-- Chiffre d'affaires (hors commandes annulées) :
--   SELECT SUM(total_cents) / 100 AS chiffre_affaires_euros
--   FROM orders WHERE status <> 'annulee';
-- ============================================================================
-- Base déjà créée avec l'ancienne version du schéma ? Appliquez cette migration :
-- ============================================================================
--   DELETE FROM products WHERE category <> 'bouquets';
--   ALTER TABLE products MODIFY category ENUM('bouquets') NOT NULL DEFAULT 'bouquets';
--   ALTER TABLE order_items
--     ADD COLUMN options_cents INT UNSIGNED NOT NULL DEFAULT 0 AFTER unit_price_cents,
--     ADD COLUMN options JSON NULL AFTER options_cents;
