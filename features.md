# StockSense - Complete Feature Matrix & Capabilities

StockSense is an enterprise-grade, real-time inventory management system built with Node.js, Express.js, MongoDB (Mongoose), EJS, and Vanilla CSS/Tailwind styling. It provides double-entry stock accounting, role-based access control, barcode scanning, real-time collaboration via Server-Sent Events (SSE), historical stock auditing, and predictive replenishment.

---

## 📋 Table of Contents
1. [🔐 Authentication & Role-Based Security](#1-authentication--role-based-security)
2. [⚖️ Double-Entry Stock Ledger & Engine](#2-double-entry-stock-ledger--engine)
3. [🚚 Operations & Workflow Management](#3-operations--workflow-management)
4. [📦 Product & Category Catalog](#4-product--category-catalog)
5. [🏭 Multi-Warehouse & Location Management](#5-multi-warehouse--location-management)
6. [⚡ Live Real-Time Collaboration & SSE](#6-live-real-time-collaboration--sse)
7. [📷 Barcode / QR Label Printing & Scanning](#7-barcode--qr-label-printing--scanning)
8. [📊 Analytics, Insights & Stock Forecasting](#8-analytics-insights--stock-forecasting)
9. [📜 Audit Trail, Move History & CSV Export](#9-audit-trail-move-history--csv-export)
10. [🧪 Automated Testing & Developer Tooling](#10-automated-testing--developer-tooling)

---

## 1. 🔐 Authentication & Role-Based Security

- **Single User Model with Role-Based Access (RBAC)**
  - Enforces role separation between **`manager`** (Inventory Manager) and **`staff`** (Warehouse Staff).
  - Middleware-protected routes (`authMiddleware.js`) enforcing strict role checks (`req.user.role`).
- **JWT Session Security**
  - Secure, HTTP-only cookie-based authentication (`jsonwebtoken`, `cookie-parser`).
  - Automatic session validation and profile loading across pages.
- **Nodemailer OTP Verification**
  - 6-digit OTP email verification for user signup and account registration (`SignupOtp.js`).
  - 6-digit OTP email verification for password reset flow (`/auth/forgot-password`, `/auth/verify-otp`, `/auth/reset-password`).
  - **Console Fallback Mode**: Automatically logs OTP codes to the terminal console during development if SMTP credentials are missing.
- **Password Hashing & Profile Management**
  - Industry-standard password hashing using `bcryptjs`.
  - User profile page (`/profile`) allowing users to view details, update personal info, change passwords, and view role permissions.

---

## 2. ⚖️ Double-Entry Stock Ledger & Engine

- **Double-Entry Inventory Model**
  - Every stock movement is logged as a paired transfer (`StockMove`) from a source location to a destination location.
  - Guarantees complete auditability with non-destructive, append-only move ledgers.
- **Atomic MongoDB Transactions**
  - Uses MongoDB session transactions to execute stock validation, stock quant updates, and move logging atomically.
  - Prevents race conditions and guarantees zero stock corruption or partial updates.
- **Stock Quants (`StockQuant`)**
  - Tracks exact physical on-hand quantities per product per specific bin/location.
  - Automatic calculations of **On Hand**, **Free to Use**, **Incoming**, and **Outgoing** inventory metrics.
- **Hierarchical Location Types**
  - Supports `internal` (warehouses, shelves, bins), `vendor` (suppliers), `customer` (end users), `inventory` (virtual loss/gain adjustment points), and `transit` locations.
- **Sequential Document Numbering**
  - Counter-based auto-incrementing reference sequence generator (`Counter.js`):
    - Receipts: `WH/IN/00001`
    - Deliveries: `WH/OUT/00001`
    - Internal Transfers: `WH/INT/00001`
    - Physical Adjustments: `WH/ADJ/00001`

---

## 3. 🚚 Operations & Workflow Management

- **Receipts (Incoming Goods / `WH/IN`)**
  - Track supplier deliveries, scheduled dates, receiving locations, and line-item quantities.
  - Validating a receipt automatically creates stock quants and logs incoming stock movements.
- **Deliveries (Outgoing Goods / `WH/OUT`)**
  - Customer order fulfillment workflow featuring a 2-step **Pick & Pack** status progression.
  - Automated inventory availability checks to highlight shortages before picking.
- **Internal Transfers (`WH/INT`)**
  - Move stock seamlessly between warehouses or internal bin locations.
- **Physical Inventory Adjustments (`WH/ADJ`)**
  - Perform partial or full stock counts across specific warehouse locations.
  - **Blind Count Mode**: Hide expected stock levels from warehouse staff during counting to prevent bias.
  - **Reason Codes**: Tag stock variances with explicit reasons (`count`, `damaged`, `lost`, `found`, `expired`).
  - **Manager Approval**: Requires manager authorization to validate variances and write ledger corrections.
- **Operation Lifecycle States**
  - Full state transition pipeline: `Draft` ➔ `Waiting Availability` / `Ready` ➔ `Picked` ➔ `Packed` ➔ `Validated (Done)`.
  - Operations can be reset to draft, duplicated, or canceled safely.
- **Printable Worksheets**
  - Clean print templates ([views/operations/print.ejs](file:///c:/Users/yella/Downloads/StockSense/views/operations/print.ejs)) for physical pick lists, packing slips, and receiving vouchers.

---

## 4. 📦 Product & Category Catalog

- **Rich Product Catalog (`Product.js`, `productService.js`)**
  - Stores SKU, Barcode, Product Name, Category, Unit of Measure (UOM), Cost Price, Selling Price, Reorder Level, and Reorder Quantity.
- **Locked Unit of Measure (UOM)**
  - Automatically locks UOM editing once stock moves exist for a product to prevent unit mismatches.
- **Categorization & Hierarchy (`Category.js`)**
  - Categorize products into customizable groups with live product counters.
  - Deletion guardrails block deleting categories that still contain active products.
- **Product Lifecycle & Archiving**
  - Dynamic status tracking (`ok`, `low`, `out`, `attention`).
  - Safe archiving and restoration: products can only be archived if on-hand stock is zero and no open operations exist.

---

## 5. 🏭 Multi-Warehouse & Location Management

- **Multi-Warehouse Configuration (`Warehouse.js`, `warehouseService.js`)**
  - Create and manage multiple warehouse locations with fixed short codes (e.g. `WH`, `MAIN`, `NORTH`).
  - Automatic creation of standard default locations (`Stock`, `Input`, `Output`) per warehouse.
- **Custom Location Hierarchy (`Location.js`)**
  - Define granular sub-locations (e.g. `WH/Stock/Aisle-1/Shelf-B`).
- **Location Archiving Guardrails**
  - Prevents archiving locations containing active stock or bound to open draft/ready operations.

---

## 6. ⚡ Live Real-Time Collaboration & SSE

- **Server-Sent Events Broadcast Hub (`liveHub.js`, `liveController.js`)**
  - Real-time event pipeline streaming live updates to clients connected via `GET /api/live`.
  - Dashboard KPIs, operation lists, sidebar badges, and alerts update instantly without refreshing the browser.
- **Collaborative Live Presence**
  - Shows real-time user avatars and presence indicators on operation detail views (`viewing: operation:<id>`).
  - Alerts team members when someone else is currently viewing or modifying the same document.
- **Instant System Alerts**
  - Broadcasts critical stock events (e.g., low stock triggers, operation validations) live to all connected sessions.

---

## 7. 📷 Barcode / QR Label Printing & Scanning

- **Printable Barcodes & Labels (`/labels`)**
  - Generates printable Code 128 barcodes for products, location bins, and operation reference numbers.
- **Multi-Input Scanning Engine (`public/js/scan.js`)**
  - Integrates hardware USB barcode scanners, keyboard wedge scanners, and web cameras (via Quagga / Html5Qrcode).
- **Interactive Scan & Pick Workflow**
  - Scan product barcodes directly on open receipts or delivery orders to increment picked/packed quantities.
  - Sound/visual feedback for correct items, incorrect items, wrong bins, or over-picking.
  - Auto-marks lines complete when scanned quantities match target quantities.
- **Universal Barcode Resolver (`/scan`)**
  - Universal scan route that automatically identifies whether a scanned code is a product, location, or operation document and routes the user directly to its page.

---

## 8. 📊 Analytics, Insights & Stock Forecasting

- **Interactive Manager Dashboard (`/dashboard`)**
  - Executive KPI summary: Total Inventory Value, Low Stock Alerts, Open Operations count, and Stockout Risks.
  - **Today's Board**: Visual kanban pipeline showing daily flow (Receive ➔ Pick ➔ Pack ➔ Ship ➔ Late items).
  - 14-day stock flow charts and stock outlook categorizations.
- **Stock Time Machine (`/insights/time-machine`)**
  - Historical point-in-time stock reconstruction: view exact stock levels and inventory valuation for any past date/time by rewinding the double-entry ledger.
- **Stockout Forecast & Cover Days Calculation**
  - Calculates 30-day average daily usage (burn rate) per product.
  - Computes exact **Days of Cover**, **Predicted Stockout Date**, and **Recommended Order Date** (accounting for lead times).
  - 60-day historical + 30-day forward projection timeline chart per product (`GET /api/products/:id/timeline`).
- **Automated Replenishment Engine (`/replenishment`)**
  - Scans inventory for items facing imminent stockouts.
  - Groups suggested reorder quantities by preferred supplier, taking into account already incoming purchase orders.
  - **One-Click PO Generation**: Converts selected replenishment suggestions into confirmed draft receipt operations in one click.

---

## 9. 📜 Audit Trail, Move History & CSV Export

- **Comprehensive Ledger History (`/moves`)**
  - Searchable and filterable ledger of every individual stock transaction.
  - Filters by product, location, operation type, user, and date range.
  - Displays running balance per movement for complete transparency.
- **CSV Ledger Export (`/moves/export.csv`)**
  - Single-click export of filtered stock move records to standard CSV files for offline auditing and reporting.
- **Activity Log (`Activity.js`, `activityService.js`)**
  - Records user actions across the platform (e.g. validated receipt, updated product, created location) and displays a real-time audit feed on the dashboard.
- **Stock Alerts & Email Notifications (`Alert.js`, `alertService.js`)**
  - Automatically raises low-stock and out-of-stock alerts when stock crosses reorder levels.
  - Sends immediate email alerts to managers and displays unread alert counters in the app header.

---

## 10. 🧪 Automated Testing & Developer Tooling

- **Robust Automated Test Suite**
  - `test/stockService.test.js`: Validates double-entry accounting math, atomic transaction rollbacks, and quant calculations using `mongodb-memory-server`.
  - `test/api.test.js`: Integration tests for HTTP routes (Auth, Products, Operations, Scanning, Warehouses).
  - `test/features.test.js`: End-to-end tests for advanced features (Time Machine, Replenishment, Adjustments, SSE Live Hub).
- **Developer Utilities**
  - `scripts/local-db.js`: Standalone script to spawn a local MongoDB instance with replica set support for testing multi-document transactions offline.
  - `scripts/seed.js`: Comprehensive database seeder providing realistic demo warehouses, products, categories, operations, and pre-configured logins.
