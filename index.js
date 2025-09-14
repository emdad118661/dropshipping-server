// npm i express cors mongodb dotenv
const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors({ origin: ['http://localhost:5173', 'http://localhost:3000'] })); // React dev URL
app.use(express.json());

app.get('/', (req, res) => {
    res.send('Hello World!')
});

// .env e MONGODB_URI, DB_NAME set kore nao
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