# StockSense - System & Architecture Project Flow

StockSense is an enterprise-grade, real-time inventory and warehouse management system built with Node.js, Express.js, MongoDB (Mongoose), EJS, and Vanilla CSS/Tailwind styling. This document outlines the end-to-end technical data flow, operational lifecycles, real-time event pipeline, and architectural workflows.

---

## 🗺️ High-Level Architectural Diagram

```
                        ┌────────────────────────────────────────────────────────┐
                        │                      Client Layer                      │
                        │   EJS Views + Tailwind CSS + Vanilla JS + Three.js    │
                        └───────────────────────────┬────────────────────────────┘
                                                    │  HTTP / Server-Sent Events
                                                    ▼
                        ┌────────────────────────────────────────────────────────┐
                        │                     Express Server                     │
                        │    Auth Middleware · Controllers · Route Handlers      │
                        └──────────┬────────────────┬────────────────┬───────────┘
                                   │                │                │
            ┌──────────────────────┘                │                └──────────────────────┐
            ▼                                       ▼                                       ▼
┌───────────────────────┐       ┌───────────────────────┐       ┌───────────────────────┐
│     Resend API        │       │   Stock & Ledger      │       │     SSE Live Hub      │
│  (OTP & Alert Emails) │       │   Engine (Service)    │       │ (Real-time Broadcast) │
└───────────────────────┘       └───────────┬───────────┘       └───────────────────────┘
                                            │ Atomic Session
                                            ▼
                                ┌───────────────────────┐
                                │   MongoDB Database    │
                                │ StockQuant / StockMove│
                                └───────────────────────┘
```

---

## 📋 Table of Contents
1. [🔐 1. User Authentication & Role Workflow](#1-user-authentication--role-workflow)
2. [⚖️ 2. Double-Entry Stock Ledger & Engine Lifecycle](#2-double-entry-stock-ledger--engine-lifecycle)
3. [🚚 3. Operational Document Workflows](#3-operational-document-workflows)
4. [⚡ 4. Real-Time Collaboration & SSE Broadcast Pipeline](#4-real-time-collaboration--sse-broadcast-pipeline)
5. [📷 5. Barcode Scanning & Label Resolution Workflow](#5-barcode-scanning--label-resolution-workflow)
6. [📊 6. Time Machine, Forecasting & Replenishment Data Flow](#6-time-machine-forecasting--replenishment-data-flow)

---

## 🔐 1. User Authentication & Role Workflow

```
[ User Request ] ──► [ POST /auth/send-signup-otp ] ──► [ Generate 6-Digit OTP ]
                                                                 │
                                                                 ▼
[ Authenticated Cookie ] ◄── [ Set JWT Cookie ] ◄── [ POST /auth/signup ] ◄── [ Send Email via Resend ]
```

1. **OTP Request & Email Delivery**:
   - User inputs email at `/auth/signup`.
   - `authController.sendSignupOtp` generates a 6-digit random code stored in `SignupOtp` schema with a 10-minute expiry.
   - `utils/sendEmail` dispatches the OTP via the **Resend API** (or outputs to console in dev mode if `RESEND_API_KEY` is omitted).
2. **Account Creation & Verification**:
   - User submits form with name, email, password, role (`manager` or `staff`), and 6-digit OTP.
   - Password is hashed with `bcryptjs`.
   - JWT session token signed (`jsonwebtoken`) and attached as an `HttpOnly` secure cookie.
3. **Role-Based Middleware Scope (`authMiddleware.js`)**:
   - Every request validates the JWT session.
   - Routes check `req.user.role`:
     - **`manager`**: Full administrative access (create/edit products, categories, warehouses, validate inventory adjustments, view reports).
     - **`staff`**: Operational access (receive goods, pick/pack deliveries, perform internal transfers and physical stock counts).

---

## ⚖️ 2. Double-Entry Stock Ledger & Engine Lifecycle

StockSense treats inventory like a double-entry financial accounting ledger. Stock is never mutated arbitrarily; it only moves from a **Source Location** to a **Destination Location**.

```
┌──────────────────────────┐          Stock Movement          ┌──────────────────────────┐
│     Source Location      │ ───────────────────────────────► │   Destination Location   │
│   (e.g., WH/Stock/A1)    │      Logged as StockMove        │   (e.g., Customer/Out)   │
└──────────────────────────┘                                  └──────────────────────────┘
```

1. **Location Types**:
   - `internal`: Physical bins/shelves inside warehouses (e.g., `WH/Stock`, `WH/Input`).
   - `vendor`: Virtual supplier source for incoming goods (`Vendor/Suppliers`).
   - `customer`: Virtual destination for outgoing customer deliveries (`Customer/Customers`).
   - `inventory`: Virtual adjustment point for physical stock count gains/losses (`Virtual/Inventory Loss`).
2. **Atomic MongoDB Transactions (`stockService.js`)**:
   - When an operation is validated:
     a. A MongoDB Session Transaction is initiated.
     b. On-hand quantities in `StockQuant` are updated at the source and destination locations.
     c. `StockMove` ledger entries are generated with running balance snapshots.
     d. Operation status is marked `done`.
     e. If any step fails, the entire transaction is rolled back, ensuring zero data corruption.

---

## 🚚 3. Operational Document Workflows

### A. Receipts (Incoming Goods / `WH/IN`)
`Draft` ➔ `Confirm (Ready)` ➔ `Validate (Done)`
- Stock moves from `Vendor/Suppliers` to `WH/Input` or `WH/Stock`.

### B. Deliveries (Outgoing Goods / `WH/OUT`)
`Draft` ➔ `Confirm` ➔ `Waiting / Ready` ➔ `Picked` ➔ `Packed` ➔ `Validate (Done)`
- Checks stock availability at `WH/Stock`.
- 2-Step Pick and Pack verification.
- Validating transfers stock from `WH/Stock` to `Customer/Customers`.

### C. Internal Transfers (`WH/INT`)
`Draft` ➔ `Confirm (Ready)` ➔ `Validate (Done)`
- Moves stock between internal warehouse bins (e.g. `WH1/Stock` ➔ `WH2/Stock`).

### D. Physical Inventory Adjustments (`WH/ADJ`)
`Draft` ➔ `Count Sheet Entry` ➔ `Manager Approval & Validation`
- Compares physical counted stock against recorded `StockQuant`.
- Tagged with variance reasons (`count`, `damaged`, `lost`, `found`, `expired`).
- Validating balances the variance via `Virtual/Inventory Loss`.

---

## ⚡ 4. Real-Time Collaboration & SSE Broadcast Pipeline

```
[ Stock Action (e.g., Validated) ] ──► [ stock.events Emitter ]
                                                 │
                                                 ▼
[ Client UI Auto-Updates ] ◄── [ Server-Sent Events Broadcast ] ◄── [ liveHub.broadcast() ]
```

1. **Server-Sent Events Channel (`GET /api/live`)**:
   - Long-lived HTTP stream established between client browsers and `liveHub.js`.
2. **Event Triggers**:
   - Validation of receipts/deliveries, creation of operations, or low-stock crossings emit events.
   - `liveHub.broadcast()` broadcasts updates instantly to all connected clients.
3. **Collaborative Live Presence**:
   - When a user views an operation page (`/operations/:id`), presence events broadcast `viewing: operation:<id>`.
   - Other users viewing the same document see live user avatars and activity toasts.

---

## 📷 5. Barcode Scanning & Label Resolution Workflow

```
[ Barcode Scan (Code 128) ] ──► [ Hardware / Camera Scanner ] ──► [ GET /api/scan/resolve ]
                                                                           │
                                                                           ▼
[ Auto-Increment Pick Line ] ◄── [ Match SKU / Location / Doc ] ◄──────────┘
```

1. **Label Generation (`/labels`)**:
   - Renders Code 128 barcodes for SKUs, Location Bins, and Operation references (`WH/IN/00001`).
2. **Multi-Input Scanning Engine (`public/js/scan.js`)**:
   - Accepts input from USB hardware scanners, camera feeds (Quagga/Html5Qrcode), or manual input.
3. **Interactive Pick & Pack**:
   - Scanning a product barcode on an open delivery increments the picked quantity.
   - Correct items emit a success chime; wrong items or over-picking trigger visual/audio warnings.
4. **Universal Resolver (`/scan`)**:
   - Scanned barcodes are sent to `/api/scan/resolve`, which routes the user straight to the matching Product, Location, or Operation view.

---

## 📊 6. Time Machine, Forecasting & Replenishment Data Flow

### A. Stock Time Machine (`/insights/time-machine`)
- Rebuilds exact point-in-time stock levels for any historical date by rewinding the `StockMove` ledger backward from current `StockQuant` totals.

### B. Stockout Forecasting
- Calculates 30-day average daily usage (burn rate) per product:
  $$\text{Days of Cover} = \frac{\text{On-Hand Stock}}{\text{Average Daily Usage}}$$
- Predicts exact **Stockout Date** and **Order-By Date** ($\text{Stockout Date} - \text{Supplier Lead Time}$).

### C. Automated Replenishment Engine (`/replenishment`)
- Scans products with stockout risk.
- Groups reorder recommendations by preferred supplier, accounting for pending incoming purchase orders.
- Converts selected replenishment groups into draft receipt operations in **1 click**.
