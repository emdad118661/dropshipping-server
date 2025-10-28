// npm i express cors mongodb dotenv cookie-parser bcryptjs jsonwebtoken
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");                // NEW
const bcrypt = require("bcryptjs");                           // NEW
const jwt = require("jsonwebtoken");                          // NEW
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

app.set("trust proxy", 1);
app.use(express.json());
app.use(cookieParser());                                      // NEW

// ===== CORS (don't pass URLs as route paths) =====
const frontendOrigin = (process.env.FRONTEND_ORIGIN || "").replace(/\/$/, ""); // no trailing slash
const allowedOrigins = [
  frontendOrigin,                 // e.g. https://dropshipping-client.onrender.com
  "http://localhost:5173",
  "http://localhost:3000",
].filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);                 // Postman/curl
      return cb(allowedOrigins.includes(origin) ? null : new Error("Not allowed by CORS"), true);
    },
    credentials: true,                                     // CHANGED: cookies pathanor jonno
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
// NOTE: app.options("*", cors()) - ta dorkar nei; kichu setup e eta path parser error dite pare

// Health + root
app.get("/health", (req, res) => res.status(200).json({ ok: true }));
app.get("/", (req, res) => res.send("API is running"));

// ===== Mongo =====
const uri = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || "Dropshipping";
const COLLECTION = process.env.COLLECTION || "Products";
const USERS_COLLECTION = process.env.USERS_COLLECTION || "users";      // NEW

const client = new MongoClient(uri, {
  serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true },
  serverSelectionTimeoutMS: 10000,
});

let productsCol = null;
let usersCol = null;                                                   // NEW

async function connectWithRetry() {
  try {
    if (!uri) throw new Error("MONGODB_URI missing");
    await client.connect();
    await client.db("admin").command({ ping: 1 });
    const db = client.db(DB_NAME);
    productsCol = db.collection(COLLECTION);
    usersCol = db.collection(USERS_COLLECTION);                         // NEW
    try { await productsCol.createIndex({ category: 1 }); } catch {}
    try { await usersCol.createIndex({ email: 1 }, { unique: true }); } catch {} // NEW
    console.log(`Mongo connected → ${DB_NAME}.${COLLECTION} & ${USERS_COLLECTION}`);

    // Optional: seed root superadmin from env
    if (process.env.ROOT_ADMIN_EMAIL && process.env.ROOT_ADMIN_PASSWORD) {
      const email = process.env.ROOT_ADMIN_EMAIL.toLowerCase();
      const exists = await usersCol.findOne({ email });
      if (!exists) {
        const hash = await bcrypt.hash(process.env.ROOT_ADMIN_PASSWORD, 10);
        await usersCol.insertOne({
          name: "Root Admin",
          email,
          passwordHash: hash,
          role: "superadmin",
          createdAt: new Date(),
        });
        console.log("Seeded superadmin:", email);
      }
    }
  } catch (e) {
    console.error("Mongo connect failed:", e.message);
    productsCol = null;
    usersCol = null;
    setTimeout(connectWithRetry, 5000);
  }
}

// ===== Helpers (Products) =====
const CATEGORY_MAP = {
  clothing: "Clothing",
  "traditional-wear": "Traditional Wear",
  footwear: "Footwear",
  accessories: "Accessories",
};

function parseListParams(req) {
  const limit = Math.max(0, parseInt(req.query.limit, 10) || 0); // 0 = no limit
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const skip = limit ? (page - 1) * limit : 0;

  let sort;
  switch (req.query.sort) {
    case "price-asc":  sort = { price: 1 }; break;
    case "price-desc": sort = { price: -1 }; break;
    case "name-asc":   sort = { name: 1 }; break;
    case "name-desc":  sort = { name: -1 }; break;
    default:           sort = undefined; // API order (Featured)
  }
  return { limit, page, skip, sort };
}

function listByCategory(categoryValue) {
  return async (req, res) => {
    try {
      if (!productsCol) return res.status(503).json({ message: "DB not ready" });
      const { limit, skip, sort } = parseListParams(req);
      const cursor = productsCol.find({ category: categoryValue });
      if (sort) cursor.sort(sort);
      if (skip) cursor.skip(skip);
      if (limit) cursor.limit(limit);
      res.json(await cursor.toArray());
    } catch (e) {
      console.error(e);
      res.status(500).json({ message: "Failed to fetch products" });
    }
  };
}

// ===== Auth helpers (NEW) =====
const JWT_SECRET = process.env.JWT_SECRET || "change_me";

function signToken(user) {
  return jwt.sign(
    { sub: user._id.toString(), role: user.role, email: user.email },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function setAuthCookie(res, token) {
  res.cookie("token", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

function auth(req, res, next) {
  const token = req.cookies?.token || (req.headers.authorization || "").split(" ")[1];
  if (!token) return res.status(401).json({ message: "Unauthorized" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ message: "Invalid token" });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ message: "Forbidden" });
    next();
  };
}

// ===== Auth Routes (NEW) =====

// Register (customers self-register)
app.post("/auth/register", async (req, res) => {
  try {
    if (!usersCol) return res.status(503).json({ message: "DB not ready" });
    const { name, email, phone, address, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ message: "Missing required fields" });

    const emailL = email.toLowerCase();
    const exists = await usersCol.findOne({ email: emailL });
    if (exists) return res.status(409).json({ message: "Email already registered" });

    const passwordHash = await bcrypt.hash(password, 10);
    const doc = {
      name,
      email: emailL,
      phone: phone || "",
      address: address || "",
      passwordHash,
      role: "customer",
      createdAt: new Date(),
    };
    const { insertedId } = await usersCol.insertOne(doc);
    const user = { _id: insertedId, name, email: emailL, role: "customer" };

    const token = signToken(user);
    setAuthCookie(res, token);
    res.status(201).json({ user });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Registration failed" });
  }
});

// Login (common)
app.post("/auth/login", async (req, res) => {
  try {
    if (!usersCol) return res.status(503).json({ message: "DB not ready" });
    const { email, password } = req.body;
    const emailL = (email || "").toLowerCase();
    const userDoc = await usersCol.findOne({ email: emailL });
    if (!userDoc) return res.status(401).json({ message: "Invalid credentials" });

    const ok = await bcrypt.compare(password, userDoc.passwordHash);
    if (!ok) return res.status(401).json({ message: "Invalid credentials" });

    const user = { _id: userDoc._id, name: userDoc.name, email: userDoc.email, role: userDoc.role };
    const token = signToken(user);
    setAuthCookie(res, token);
    res.json({ user });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Login failed" });
  }
});

// Logout
app.post("/auth/logout", (req, res) => {
  res.clearCookie("token", { httpOnly: true, sameSite: "lax" }).json({ ok: true });
});

// Current user
app.get("/auth/me", auth, async (req, res) => {
  try {
    if (!usersCol) return res.status(503).json({ message: "DB not ready" });
    const user = await usersCol.findOne(
      { _id: new ObjectId(req.user.sub) },
      { projection: { passwordHash: 0 } }
    );
    if (!user) return res.status(401).json({ message: "Unauthorized" });
    res.json({ user });
  } catch {
    res.status(500).json({ message: "Failed to fetch profile" });
  }
});

// OPTIONAL: superadmin can create admins
app.post("/admin/create-admin", auth, requireRole("superadmin"), async (req, res) => {
  try {
    if (!usersCol) return res.status(503).json({ message: "DB not ready" });
    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ message: "Missing fields" });

    const emailL = email.toLowerCase();
    const exists = await usersCol.findOne({ email: emailL });
    if (exists) return res.status(409).json({ message: "Email already used" });

    const hash = await bcrypt.hash(password, 10);
    const { insertedId } = await usersCol.insertOne({
      name,
      email: emailL,
      passwordHash: hash,
      role: "admin",
      createdAt: new Date(),
      createdBy: new ObjectId(req.user.sub),
    });
    res.status(201).json({ id: insertedId, email: emailL, role: "admin" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Failed to create admin" });
  }
});

// ===== Routes (Products — unchanged) =====

// IMPORTANT: category route BEFORE ":id" route (otherwise /products/category/... will hit :id)
app.get("/products/category/:slug", async (req, res) => {
  try {
    if (!productsCol) return res.status(503).json({ message: "DB not ready" });
    const dbValue = CATEGORY_MAP[req.params.slug?.toLowerCase()];
    if (!dbValue) return res.status(400).json({ message: "Invalid category" });

    const { limit, skip, sort } = parseListParams(req);
    const cursor = productsCol.find({ category: dbValue });
    if (sort) cursor.sort(sort);
    if (skip) cursor.skip(skip);
    if (limit) cursor.limit(limit);
    res.json(await cursor.toArray());
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Failed to fetch products" });
  }
});

// Fixed category shortcuts
app.get("/products/clothing",          listByCategory("Clothing"));
app.get("/products/traditional-wear",  listByCategory("Traditional Wear"));
app.get("/products/footwear",          listByCategory("Footwear"));
app.get("/products/accessories",       listByCategory("Accessories"));

// All products
app.get("/products", async (req, res) => {
  try {
    if (!productsCol) return res.status(503).json({ message: "DB not ready" });
    const { limit, skip, sort } = parseListParams(req);
    const cursor = productsCol.find({});
    if (sort) cursor.sort(sort);
    if (skip) cursor.skip(skip);
    if (limit) cursor.limit(limit);
    res.json(await cursor.toArray());
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Failed to fetch products" });
  }
});

// Single product
app.get("/products/:id", async (req, res) => {
  try {
    if (!productsCol) return res.status(503).json({ message: "DB not ready" });
    const { id } = req.params;
    if (!ObjectId.isValid(id)) return res.status(400).json({ message: "Invalid id" });
    const doc = await productsCol.findOne({ _id: new ObjectId(id) });
    if (!doc) return res.status(404).json({ message: "Not found" });
    res.json(doc);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Failed to fetch product" });
  }
});

// ===== Start =====
const server = app.listen(PORT, () => {
  console.log("PORT env =", process.env.PORT);
  console.log(`Server listening on ${PORT}`);
  connectWithRetry();
});

process.on("SIGTERM", async () => {
  try { await client.close(); } catch {}
  server.close(() => process.exit(0));
});