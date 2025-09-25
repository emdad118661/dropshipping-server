const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);
app.use(express.json());
app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://localhost:3000',
    process.env.FRONTEND_ORIGIN, // e.g. https://your-frontend.onrender.com
  ].filter(Boolean),
  credentials: true,
}));

app.get('/health', (req, res) => res.json({ ok: true, db: !!global.productsCol }));

app.get('/', (req, res) => res.send('API is running'));

const uri = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || 'Dropshipping';
const COLLECTION = process.env.COLLECTION || 'Products';

const client = new MongoClient(uri, {
  serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true },
  serverSelectionTimeoutMS: 10000,
});

global.productsCol = null;

async function connectWithRetry() {
  try {
    if (!uri) throw new Error('MONGODB_URI missing');
    await client.connect();
    await client.db('admin').command({ ping: 1 });
    const db = client.db(DB_NAME);
    global.productsCol = db.collection(COLLECTION);
    console.log(`Mongo connected → ${DB_NAME}.${COLLECTION}`);
  } catch (e) {
    console.error('Mongo connect failed:', e.message);
    global.productsCol = null;
    setTimeout(connectWithRetry, 5000); // 5s পরে আবার চেষ্টা
  }
}

// server আগে উঠুক, তারপর DB connect চেষ্টা
app.listen(PORT, () => {
  console.log('PORT env =', process.env.PORT);
  console.log(`Server listening on ${PORT}`);
  connectWithRetry();
});

// Routes
app.get('/products', async (req, res) => {
  if (!global.productsCol) return res.status(503).json({ message: 'DB not ready' });
  try {
    const items = await global.productsCol.find({}).toArray();
    res.json(items);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Failed to fetch products' });
  }
});

app.get('/products/:id', async (req, res) => {
  if (!global.productsCol) return res.status(503).json({ message: 'DB not ready' });
  try {
    const doc = await global.productsCol.findOne({ _id: new ObjectId(req.params.id) });
    if (!doc) return res.status(404).json({ message: 'Not found' });
    res.json(doc);
  } catch {
    res.status(400).json({ message: 'Invalid id' });
  }
});