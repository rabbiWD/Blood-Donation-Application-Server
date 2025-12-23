const express = require('express');
const cors = require('cors');
const app = express();
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const admin = require('firebase-admin'); // ← নতুন যোগ করা
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ==================== Firebase Admin Setup ====================
// const serviceAccount = {
//   type: "service_account",
//   project_id: process.env.FIREBASE_PROJECT_ID,
//   private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
//   private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
//   client_email: process.env.FIREBASE_CLIENT_EMAIL,
//   client_id: process.env.FIREBASE_CLIENT_ID,
//   auth_uri: "https://accounts.google.com/o/oauth2/auth",
//   token_uri: "https://oauth2.googleapis.com/token",
//   auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
//   client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL,
// };

// if (!admin.apps.length) {
//   admin.initializeApp({
//     credential: admin.credential.cert(serviceAccount),
//   });
// }

// var serviceAccount = require('./blood-donation-firebase-adminsdk.json');
const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf8')
const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});



// Middleware: Verify Firebase JWT Token
const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Unauthorized: No token provided" });
  }

  const token = authHeader.split("Bearer ")[1];

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.user = decoded; // req.user এ ইউজারের তথ্য সেভ
    next();
  } catch (error) {
    console.error("Invalid token:", error);
    return res.status(401).json({ message: "Unauthorized: Invalid token" });
  }
};

// Middleware: Check if user is Admin
const isAdmin = async (req, res, next) => {
  try {
    const email = req.user.email;
    const user = await userCollections.findOne({ email });
    if (!user || user.role !== "admin") {
      return res.status(403).json({ message: "Forbidden: Admin access required" });
    }
    next();
  } catch (error) {
    return res.status(403).json({ message: "Forbidden" });
  }
};

// ==================== MongoDB Connection ====================
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.vuj5cyn.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
  serverSelectionTimeoutMS: 5000,
  connectTimeoutMS: 10000,
  maxPoolSize: 10,
  socketTimeoutMS: 45000,

});

let userCollections, donationRequestsCollection, fundingCollection;

async function run() {
  try {
    // await client.connect();
    const db = client.db('blood_db');
    userCollections = db.collection('users');
    donationRequestsCollection = db.collection('donation_requests');
    fundingCollection = db.collection('fundings');

    console.log("Successfully connected to MongoDB!");

    // ==================== USER ROUTES ====================

    app.get("/users", async (req, res) => {
      try {
        const total = await userCollections.countDocuments({});
        res.json({ totalUsers: total });
      } catch (err) {
        res.status(500).json({ totalUsers: 0 });
      }
    });

    app.post('/users', async (req, res) => {
      try {
        const userInfo = req.body;
        const existing = await userCollections.findOne({ email: userInfo.email });
        if (existing) return res.json({ message: "User already exists", insertedId: existing._id });

        userInfo.createdAt = new Date();
        userInfo.role = 'donor';
        userInfo.status = 'active';

        const result = await userCollections.insertOne(userInfo);
        res.status(201).json(result);
      } catch (error) {
        res.status(500).json({ message: "Failed to create user" });
      }
    });

    app.get("/users/:email", verifyToken, async (req, res) => {
      try {
        const { email } = req.params;
        if (req.user.email !== email && req.user.role !== "admin") {
          return res.status(403).json({ message: "Forbidden" });
        }
        const user = await userCollections.findOne({ email });
        if (!user) return res.status(404).json({ message: "User not found" });
        res.json(user);
      } catch (error) {
        res.status(500).json({ message: "Server error" });
      }
    });

    // Admin only: Update user role/status
    app.patch("/users/:email", verifyToken, isAdmin, async (req, res) => {
      try {
        const { email } = req.params;
        const updates = req.body;
        const result = await userCollections.updateOne({ email }, { $set: updates });
        if (result.matchedCount === 0) return res.status(404).json({ message: "User not found" });
        res.json({ message: "User updated successfully" });
      } catch (error) {
        res.status(500).json({ message: "Server error" });
      }
    });

    app.get("/user/role/:email", async (req, res) => {
      try {
        const { email } = req.params;
        const user = await userCollections.findOne({ email });
        res.json({ role: user?.role || "donor", status: user?.status || "active" });
      } catch (error) {
        res.status(500).json({ message: "Server error" });
      }
    });

    // Admin only
    app.get("/all-users", verifyToken, isAdmin, async (req, res) => {
      try {
        const allUsers = await userCollections.find({}).toArray();
        res.json(allUsers);
      } catch (error) {
        res.status(500).json({ message: "Server error" });
      }
    });

    // Public donor search
    app.get("/search/donors", async (req, res) => {
      try {
        const { bloodGroup, district, upazila } = req.query;
        let query = { role: "donor", status: "active" };
        if (bloodGroup) query.bloodGroup = bloodGroup;
        if (district) query.district = district;
        if (upazila) query.upazila = upazila;

        const donors = await userCollections.find(query)
          .project({ name: 1, bloodGroup: 1, district: 1, upazila: 1, photoURL: 1 })
          .toArray();
        res.json(donors);
      } catch (error) {
        res.status(500).json({ message: "Server error" });
      }
    });

    // ==================== DONATION REQUEST ROUTES ====================

    app.post("/donation-request", verifyToken, async (req, res) => {
      try {
        const requestData = req.body;
        requestData.requesterEmail = req.user.email;
        requestData.requesterName = req.user.name || "Anonymous";
        requestData.status = "pending";
        requestData.createdAt = new Date();

        const result = await donationRequestsCollection.insertOne(requestData);
        res.status(201).json({ message: "Request created", id: result.insertedId });
      } catch (error) {
        res.status(500).json({ message: "Server error" });
      }
    });

    app.get("/donation-request/pending", async (req, res) => {
      try {
        const requests = await donationRequestsCollection
          .find({ status: "pending" })
          .sort({ createdAt: -1 })
          .toArray();
        res.json(requests);
      } catch (error) {
        res.status(500).json({ message: "Server error" });
      }
    });

    app.get("/donation-request/:id", async (req, res) => {
      try {
        const { id } = req.params;
        if (!ObjectId.isValid(id)) return res.status(400).json({ message: "Invalid ID" });
        const request = await donationRequestsCollection.findOne({ _id: new ObjectId(id) });
        if (!request) return res.status(404).json({ message: "Request not found" });
        res.json(request);
      } catch (error) {
        res.status(500).json({ message: "Server error" });
      }
    });

    // Edit request (only if pending and own request)
    app.patch("/donation-request/:id", verifyToken, async (req, res) => {
      try {
        const { id } = req.params;
        const updates = req.body;
        const request = await donationRequestsCollection.findOne({ _id: new ObjectId(id) });

        if (!request) return res.status(404).json({ message: "Request not found" });
        if (request.requesterEmail !== req.user.email) return res.status(403).json({ message: "Forbidden" });
        if (request.status !== "pending") return res.status(400).json({ message: "Can only edit pending requests" });

        const allowed = ["recipientName", "hospitalName", "fullAddress", "bloodGroup", "district", "upazila", "donationDate", "donationTime", "requestMessage"];
        const filtered = {};
        allowed.forEach(f => { if (updates[f] !== undefined) filtered[f] = updates[f]; });

        if (Object.keys(filtered).length === 0) return res.status(400).json({ message: "No fields to update" });

        await donationRequestsCollection.updateOne({ _id: new ObjectId(id) }, { $set: filtered });
        res.json({ message: "Request updated successfully" });
      } catch (error) {
        res.status(500).json({ message: "Server error" });
      }
    });

    // Donate (any logged in user)
    app.patch("/donation-request/:id/donate", verifyToken, async (req, res) => {
      try {
        const { id } = req.params;
        const result = await donationRequestsCollection.updateOne(
          { _id: new ObjectId(id), status: "pending" },
          {
            $set: {
              status: "inprogress",
              donorName: req.user.name || "Anonymous",
              donorEmail: req.user.email,
              donatedAt: new Date()
            }
          }
        );

        if (result.matchedCount === 0) return res.status(404).json({ message: "Request not found or already taken" });
        res.json({ message: "Donation confirmed" });
      } catch (error) {
        res.status(500).json({ message: "Server error" });
      }
    });

    // Status change (only requester)
    app.patch("/donation-request/:id/status", verifyToken, async (req, res) => {
      try {
        const { id } = req.params;
        const { status } = req.body;
        if (!["done", "canceled"].includes(status)) return res.status(400).json({ message: "Invalid status" });

        const request = await donationRequestsCollection.findOne({ _id: new ObjectId(id) });
        if (request.requesterEmail !== req.user.email) return res.status(403).json({ message: "Forbidden" });

        await donationRequestsCollection.updateOne({ _id: new ObjectId(id) }, { $set: { status } });
        res.json({ message: "Status updated" });
      } catch (error) {
        res.status(500).json({ message: "Server error" });
      }
    });

    // Delete (admin or owner if pending)
    app.delete("/donation-request/:id", verifyToken, async (req, res) => {
      try {
        const { id } = req.params;
        const request = await donationRequestsCollection.findOne({ _id: new ObjectId(id) });

        if (!request) return res.status(404).json({ message: "Request not found" });

        const isOwner = request.requesterEmail === req.user.email;
        const isAdmin = req.user.role === "admin"; // role will be available after verifyToken + db check if needed

        if (!isAdmin && !(isOwner && request.status === "pending")) {
          return res.status(403).json({ message: "Forbidden" });
        }

        await donationRequestsCollection.deleteOne({ _id: new ObjectId(id) });
        res.json({ message: "Deleted successfully" });
      } catch (error) {
        res.status(500).json({ message: "Server error" });
      }
    });

    app.get("/my-donation-request/:email", verifyToken, async (req, res) => {
      try {
        const { email } = req.params;
        if (req.user.email !== email) return res.status(403).json({ message: "Forbidden" });

        const limit = parseInt(req.query.limit) || 0;
        let cursor = donationRequestsCollection
          .find({ requesterEmail: email })
          .sort({ createdAt: -1 })
          .project({
            recipientName: 1, bloodGroup: 1, district: 1, upazila: 1,
            donationDate: 1, donationTime: 1, status: 1, donorName: 1, donorEmail: 1
          });

        if (limit > 0) cursor = cursor.limit(limit);
        const requests = await cursor.toArray();
        res.json(requests);
      } catch (error) {
        res.status(500).json({ message: "Server error" });
      }
    });

    app.get("/all-blood-donation-request", async (req, res) => {
      // Public route - no auth needed
      try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        const { status, bloodGroup, district } = req.query;

        let query = {};
        if (status && status !== "") query.status = status;
        if (bloodGroup && bloodGroup !== "") query.bloodGroup = bloodGroup;
        if (district && district.trim() !== "") query.district = { $regex: new RegExp(district.trim(), "i") };

        const totalRequests = await donationRequestsCollection.countDocuments(query);

        const requests = await donationRequestsCollection
          .find(query)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .toArray();

        const pagination = {
          currentPage: page,
          totalPages: Math.ceil(totalRequests / limit),
          totalRequests,
        };

        res.json({ requests, pagination });
      } catch (error) {
        res.status(500).json({ message: "Server error" });
      }
    });

    // ==================== FUNDING ROUTES (Public) ====================
    app.post("/create-payment-intent", async (req, res) => {
      const { amount } = req.body;
      if (!amount || amount < 50) return res.status(400).json({ message: "Minimum 50 BDT" });

      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amount * 100,
          currency: "bdt",
        });
        res.json({ clientSecret: paymentIntent.client_secret });
      } catch (err) {
        res.status(500).json({ message: "Payment failed" });
      }
    });

    app.post("/fundings", verifyToken, async (req, res) => {
      const { amount, transactionId } = req.body;
      if (!amount) return res.status(400).json({ message: "Amount required" });

      const newFunding = {
        amount: parseInt(amount),
        donorName: req.user.name || "Anonymous",
        donorEmail: req.user.email,
        transactionId: transactionId || null,
        createdAt: new Date(),
      };

      try {
        const result = await fundingCollection.insertOne(newFunding);
        res.json({ success: true, id: result.insertedId });
      } catch (err) {
        res.status(500).json({ message: "Failed to save funding" });
      }
    });

    app.get("/fundings", async (req, res) => {
      try {
        const fundings = await fundingCollection.find({}).sort({ createdAt: -1 }).toArray();
        const totalResult = await fundingCollection.aggregate([
          { $group: { _id: null, totalFunding: { $sum: "$amount" } } }
        ]).toArray();
        const totalFunding = totalResult[0]?.totalFunding || 0;
        res.json({ fundings, totalFunding });
      } catch (err) {
        res.status(500).json({ fundings: [], totalFunding: 0 });
      }
    });

  } catch (error) {
    console.error("MongoDB connection error:", error);
  }
}

run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('Blood donation server is running with JWT protection');
});

app.listen(port, () => {
  console.log(`Blood server is running on port ${port}`);
});