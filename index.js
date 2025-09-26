// npm i express cors mongodb dotenv
const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors({ origin: ['http://localhost:5173', '${import.meta.env.VITE_API_URL}'] })); // React dev URL
app.use(express.json());

app.get('/', (req, res) => {
    res.send('Hello World!')
});

// .env e MONGODB_URI, DB_NAME
const uri = process.env.MONGODB_URI || 'mongodb+srv://<username>:<password>@...';
const DB_NAME = process.env.DB_NAME || 'YourDbName';
const COLLECTION = process.env.COLLECTION || 'products';

const client = new MongoClient(uri, {
  serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true },
});

let productsCol;

async function start() {
  await client.connect();
  const db = client.db(DB_NAME);
  productsCol = db.collection(COLLECTION);
  console.log(`Connected to ${DB_NAME}.${COLLECTION}`);

  app.listen(port, () => console.log(`API running at http://localhost:${port}`));
}
start().catch((e) => {
  console.error('DB connect error', e);
  process.exit(1);
});

// GET all products
app.get('/products', async (req, res) => {
  try {
    const items = await productsCol
      .find({}, { projection: { /* je field lagbe add/remove koro */ } })
      .toArray();
    res.json(items);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Failed to fetch products' });
  }
});

// single product (optional)
app.get('/products/:id', async (req, res) => {
  try {
    const doc = await productsCol.findOne({ _id: new ObjectId(req.params.id) });
    if (!doc) return res.status(404).json({ message: 'Not found' });
    res.json(doc);
  } catch {
    res.status(400).json({ message: 'Invalid id' });
  }
});

// Category value mapping (URL slug -> DB value)
const CATEGORY_MAP = {
  clothing: "Clothing",
  "traditional-wear": "Traditional Wear",
  footwear: "Footwear",
  accessories: "Accessories",
};

// Optional: small helper to read limit/skip/sort from query
function parseListParams(req) {
  const limit = Math.max(0, parseInt(req.query.limit, 10) || 0); // 0 = no limit
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const skip = limit ? (page - 1) * limit : 0;

  let sort = undefined;
  switch (req.query.sort) {
    case "price-asc": sort = { price: 1 }; break;
    case "price-desc": sort = { price: -1 }; break;
    case "name-asc": sort = { name: 1 }; break;
    case "name-desc": sort = { name: -1 }; break;
    default: break; // API default order
  }
  return { limit, skip, sort };
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

      const items = await cursor.toArray();
      res.json(items);
    } catch (e) {
      console.error(e);
      res.status(500).json({ message: "Failed to fetch products" });
    }
  };
}

// 4 fixed endpoints
app.get("/products/clothing", listByCategory("Clothing"));
app.get("/products/traditional-wear", listByCategory("Traditional Wear"));
app.get("/products/footwear", listByCategory("Footwear"));
app.get("/products/accessories", listByCategory("Accessories"));

// Generic endpoint (optional): /products/category/:slug
app.get("/products/category/:slug", async (req, res) => {
  try {
    if (!productsCol) return res.status(503).json({ message: "DB not ready" });

    const dbValue = CATEGORY_MAP[req.params.slug.toLowerCase()];
    if (!dbValue) return res.status(400).json({ message: "Invalid category" });

    const { limit, skip, sort } = parseListParams(req);
    const cursor = productsCol.find({ category: dbValue });
    if (sort) cursor.sort(sort);
    if (skip) cursor.skip(skip);
    if (limit) cursor.limit(limit);

    const items = await cursor.toArray();
    res.json(items);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Failed to fetch products" });
  }
});