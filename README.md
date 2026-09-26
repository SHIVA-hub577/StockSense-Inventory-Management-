# StockSense - Role-Based Inventory & Auth System

An Express.js & MongoDB inventory management backend and UI featuring single-login role-based authentication (Inventory Manager vs. Warehouse Staff), EJS templates styled with Tailwind CSS, and Nodemailer OTP email verification for signup and password reset.

---

## 👥 Role-Based System Overview

The application enforces a **single user collection** and **one shared authentication system**. Permissions are checked at the route level via `req.user.role`.

| Role | Name | Permissions & Scope |
|---|---|---|
| **`manager`** | Inventory Manager | Creates/edits products, categories, and warehouses. Reviews dashboard KPIs. Approves & validates receipts & stock adjustments. Accesses reports & settings. |
| **`staff`** | Warehouse Staff | Performs hands-on physical operations: receiving goods, picking/packing orders, internal transfers, and physical stock counting. Restricted from settings/warehouse config. |

---

## 🚀 How to Run the Application

### 1️⃣ Step 1: Install Dependencies
Open your terminal in the project root directory and install all required packages:
```bash
npm install
```

### 2️⃣ Step 2: Configure Environment Variables
Ensure your `.env` file contains your MongoDB URI, Gmail credentials, and JWT Secret:
```env
PORT=5000
MONGO_DB_URL=your_mongodb_connection_string
GOOGLEUSER=your_gmail_address
GMAIL_APP_PASSWORD=your_gmail_app_password
JWT_SECRET=your_jwt_secret
```
Copy `.env.example` to `.env` to start. Never commit real values.

#### 🔹 Local Database (no Atlas account needed)
Stock validation uses MongoDB transactions, which need a replica set. `npm run db` starts one locally (data is kept in `.localdb/`):
```bash
npm run db      # keep this terminal open
```
Then in `.env`:
```env
MONGO_DB_URL=mongodb://127.0.0.1:27017/stocksense?replicaSet=rs0
```
If `GOOGLEUSER` / `GMAIL_APP_PASSWORD` are left empty in development, OTP emails are printed to the server console instead of being sent.

#### 🔹 Demo Data & Tests
```bash
npm run seed    # wipes inventory data and loads demo warehouses, products, operations + demo logins (see scripts/seed.js)
npm test        # stock engine tests (uses its own in-memory database)
```

### 3️⃣ Step 3: Start the Express Server

#### 🔹 Development Mode (Recommended - with Auto-Reload using Nodemon):
```bash
npm run dev
```

#### 🔹 Production Mode:
```bash
npm start
```

### 4️⃣ Step 4: Open in Web Browser
Once the terminal displays `[Server] Running in development mode on port 5000` and `[MongoDB] Connected to host`, open your browser to:

- 🌐 **Landing Page**: [http://localhost:5000/](http://localhost:5000/)
- 📝 **Signup Page (with Email OTP Verification)**: [http://localhost:5000/auth/signup](http://localhost:5000/auth/signup)
- 🔑 **Login Page**: [http://localhost:5000/auth/login](http://localhost:5000/auth/login)
- 🔒 **Forgot Password Page**: [http://localhost:5000/auth/forgot-password](http://localhost:5000/auth/forgot-password)
- 📊 **Dashboard**: [http://localhost:5000/dashboard](http://localhost:5000/dashboard)
- 📦 **Products / Categories**: [/products](http://localhost:5000/products) · [/categories](http://localhost:5000/categories)
- 🚚 **Operations**: [/receipts](http://localhost:5000/receipts) · [/deliveries](http://localhost:5000/deliveries) · [/transfers](http://localhost:5000/transfers)
- 👤 **My Profile**: [/profile](http://localhost:5000/profile)

After `npm run seed`, log in with the demo accounts listed in `scripts/seed.js`.

---

## 📡 API Endpoints

### 🔐 Authentication (`/auth`)

| Method | Endpoint | Access | Body / Params | Description |
|---|---|---|---|---|
| `POST` | `/auth/send-signup-otp` | Public | `email` | Generates 6-digit signup OTP & emails to user |
| `POST` | `/auth/signup` | Public | `name`, `email`, `password`, `role` (`"manager"` \| `"staff"`), `phone` (optional), `otp` | Validates 6-digit OTP, creates user & sets JWT cookie |
| `POST` | `/auth/login` | Public | `email`, `password` | Authenticates user & sets JWT cookie |
| `ALL` | `/auth/logout` | Public | - | Clears JWT session cookie |
| `POST` | `/auth/forgot-password` | Public | `email` | Generates 6-digit OTP & emails via Nodemailer |
| `POST` | `/auth/verify-otp` | Public | `email`, `otp` | Validates 6-digit OTP code for password reset |
| `POST` | `/auth/reset-password` | Public | `email`, `otp`, `newPassword` | Resets password (the OTP is checked again) |
| `GET` | `/auth/me` | Protected | `Bearer <token>` or Cookie | Gets currently logged in user profile |

### 📦 Inventory API (`/api`, login required)
All endpoints return JSON `{ success, message, data }`. Mutations marked **Manager** need the `manager` role.

| Method | Endpoint | Access | Description |
|---|---|---|---|
| `GET` | `/api/products` | Any | List with `search`, `category`, `status` (`ok`/`low`/`out`/`attention`), `archived=1`, `page` |
| `GET` | `/api/products/:id` | Any | Product with on hand, incoming, outgoing, forecast, stock per location, moves |
| `POST` | `/api/products` | Manager | Create (`name`, `sku`, `category`, `uom`, `reorderLevel`, `reorderQty`, optional `initialQty` + `initialLocation`) |
| `PATCH` | `/api/products/:id` | Manager | Update (unit of measure is locked once stock has moved) |
| `POST` | `/api/products/:id/archive` | `/restore` | Manager | Archive (needs zero stock and no open operations) / restore |
| `GET` / `POST` | `/api/categories` | Any / Manager | List with product counts / create |
| `PATCH` / `DELETE` | `/api/categories/:id` | Manager | Rename / delete (only when it has no products) |
| `GET` | `/api/operations?type=receipt` | Any | List with `tab` (`todo`,`ready`,`waiting`,`draft`,`done`,`canceled`,`all`), `warehouse`, `search`, `late=1`, `page` |
| `GET` | `/api/operations/:id` | Any | Operation with availability and shortages (open) or ledger moves (done) |
| `POST` | `/api/operations` | Any | Create a draft: `type`, `partner`, `sourceLocation` / `destLocation` / `location`, `scheduledDate`, `notes`, `lines: [{ product, quantity }]` |
| `PATCH` | `/api/operations/:id` | Any | Edit a draft |
| `POST` | `/api/operations/:id/confirm` | Any | Draft/waiting → `ready` (or `waiting` when stock is short) |
| `POST` | `/api/operations/:id/pick` | `/pack` | Any | Delivery progress (ready deliveries only, pick before pack) |
| `POST` | `/api/operations/:id/validate` | Any (adjustments: Manager) | Apply stock changes + write the ledger (transaction) |
| `POST` | `/api/operations/:id/reset` | `/cancel` | `/duplicate` | Any | Back to draft / cancel / copy as a new draft |
| `GET` | `/api/stock/available?location=&products=a,b` | Any | On-hand quantities at one location |
