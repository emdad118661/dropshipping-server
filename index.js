// npm i express cors mongodb dotenv
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

app.set("trust proxy", 1);
app.use(express.json());

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
    credentials: false,                                    // cookies thakle true + frontend fetch e credentials:'include'
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

const client = new MongoClient(uri, {
  serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true },
  serverSelectionTimeoutMS: 10000,
});

let productsCol = null;

async function connectWithRetry() {
  try {
    if (!uri) throw new Error("MONGODB_URI missing");
    await client.connect();
    await client.db("admin").command({ ping: 1 });
    const db = client.db(DB_NAME);
    productsCol = db.collection(COLLECTION);
    try { await productsCol.createIndex({ category: 1 }); } catch {}
    console.log(`Mongo connected → ${DB_NAME}.${COLLECTION}`);
  } catch (e) {
    console.error("Mongo connect failed:", e.message);
    productsCol = null;
    setTimeout(connectWithRetry, 5000);
  }
}

// ===== Helpers =====
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

// ===== Routes =====

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

//new desktop found