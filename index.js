const express = require('express');
const cors = require('cors');
const app = express();
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.vuj5cyn.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // await client.connect();

    const db = client.db('blood_db');
    const userCollections = db.collection('users');
    const donationRequestsCollection = db.collection('donation_requests');
    const fundingCollection = db.collection('fundings');

    console.log("Successfully connected to MongoDB!");

    // ==================== USER ROUTES ====================

    app.get("/users", async (req, res) => {
      try {
        const total = await userCollections.countDocuments({});
        res.json({ totalUsers: total });
      } catch (err) {
        console.error("Users count error:", err);
        res.status(500).json({ totalUsers: 0 });
      }
    });

    app.post('/users', async (req, res) => {
      try {
        const userInfo = req.body;
        userInfo.createdAt = new Date();
        userInfo.role = 'donor';
        userInfo.status = 'active';

        const result = await userCollections.insertOne(userInfo);
        res.status(201).json(result);
      } catch (error) {
        console.error("Create user error:", error);
        res.status(500).json({ message: "Failed to create user" });
      }
    });

    app.get("/users/:email", async (req, res) => {
      try {
        const { email } = req.params;
        const user = await userCollections.findOne({ email });
        if (!user) return res.status(404).json({ message: "User not found" });
        res.json(user);
      } catch (error) {
        console.error("Error fetching user:", error);
        res.status(500).json({ message: "Server error" });
      }
    });

    app.patch("/users/:email", async (req, res) => {
      try {
        const { email } = req.params;
        const updates = req.body;
        const result = await userCollections.updateOne({ email }, { $set: updates });
        if (result.matchedCount === 0) return res.status(404).json({ message: "User not found" });
        res.json({ message: "User updated successfully" });
      } catch (error) {
        console.error("Update user error:", error);
        res.status(500).json({ message: "Server error" });
      }
    });

    app.get("/user/role/:email", async (req, res) => {
      try {
        const { email } = req.params;
        const user = await userCollections.findOne({ email });
        if (!user) return res.status(404).json({ message: "User not found" });
        res.json({ role: user.role || "donor", status: user.status || "active" });
      } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Server error" });
      }
    });

    // Fixed: Only one /all-users route
    app.get("/all-users", async (req, res) => {
      try {
        const allUsers = await userCollections.find({}).toArray();
        res.json(allUsers);
      } catch (error) {
        console.error("Error fetching all users:", error);
        res.status(500).json({ message: "Server error" });
      }
    });

    // Public: Search donors
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
        console.error(error);
        res.status(500).json({ message: "Server error" });
      }
    });

    // ==================== DONATION REQUEST ROUTES ====================

    app.post("/donation-request", async (req, res) => {
      try {
        const requestData = req.body;
        requestData.status = "pending";
        requestData.createdAt = new Date();

        const result = await donationRequestsCollection.insertOne(requestData);
        res.status(201).json({ message: "Request created", id: result.insertedId });
      } catch (error) {
        console.error("Create request error:", error);
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
        console.error("Error fetching pending requests:", error);
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
        console.error("Error fetching request:", error);
        res.status(500).json({ message: "Server error" });
      }
    });

    app.patch("/donation-request/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const updates = req.body;

        const allowed = ["recipientName", "hospitalName", "fullAddress", "bloodGroup", "district", "upazila", "donationDate", "donationTime", "requestMessage"];
        const filtered = {};
        allowed.forEach(f => {
          if (updates[f] !== undefined) filtered[f] = updates[f];
        });

        if (Object.keys(filtered).length === 0) return res.status(400).json({ message: "No fields to update" });

        const result = await donationRequestsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: filtered }
        );

        if (result.matchedCount === 0) return res.status(404).json({ message: "Request not found" });

        res.json({ message: "Request updated successfully" });
      } catch (error) {
        console.error("Update error:", error);
        res.status(500).json({ message: "Server error" });
      }
    });

    app.patch("/donation-request/:id/donate", async (req, res) => {
      try {
        const { id } = req.params;
        const { donorName, donorEmail } = req.body;

        const result = await donationRequestsCollection.updateOne(
          { _id: new ObjectId(id), status: "pending" },
          { $set: { status: "inprogress", donorName, donorEmail, donatedAt: new Date() } }
        );

        if (result.matchedCount === 0) return res.status(404).json({ message: "Request not found or already taken" });

        res.json({ message: "Donation confirmed" });
      } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Server error" });
      }
    });

    app.patch("/donation-request/:id/status", async (req, res) => {
      try {
        const { id } = req.params;
        const { status } = req.body;
        if (!["done", "canceled"].includes(status)) return res.status(400).json({ message: "Invalid status" });

        const result = await donationRequestsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status } }
        );

        if (result.matchedCount === 0) return res.status(404).json({ message: "Request not found" });

        res.json({ message: "Status updated" });
      } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Server error" });
      }
    });

    app.delete("/donation-request/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const result = await donationRequestsCollection.deleteOne({ _id: new ObjectId(id) });
        if (result.deletedCount === 0) return res.status(404).json({ message: "Request not found" });

        res.json({ message: "Deleted successfully" });
      } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Server error" });
      }
    });

    app.get("/my-donation-request/:email", async (req, res) => {
      try {
        const { email } = req.params;
        const limit = parseInt(req.query.limit) || 0;

        let cursor = donationRequestsCollection
          .find({ requesterEmail: email })
          .sort({ createdAt: -1 })
          .project({
            recipientName: 1,
            bloodGroup: 1,
            district: 1,
            upazila: 1,
            donationDate: 1,
            donationTime: 1,
            status: 1,
            donorName: 1,
            donorEmail: 1
          });

        if (limit > 0) cursor = cursor.limit(limit);

        const requests = await cursor.toArray();
        res.json(requests);
      } catch (error) {
        console.error("Error fetching my requests:", error);
        res.status(500).json({ message: "Server error" });
      }
    });

    app.get("/all-blood-donation-request", async (req, res) => {
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
        console.error("Error fetching all requests:", error);
        res.status(500).json({ message: "Server error" });
      }
    });

    // ==================== FUNDING ROUTES ====================

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
        console.error("Stripe error:", err);
        res.status(500).json({ message: "Payment failed" });
      }
    });

    app.post("/fundings", async (req, res) => {
      const { amount, donorName, donorEmail, transactionId } = req.body;
      if (!amount || !donorName || !donorEmail) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      const newFunding = {
        amount: parseInt(amount),
        donorName,
        donorEmail,
        transactionId: transactionId || null,
        createdAt: new Date(),
      };

      try {
        const result = await fundingCollection.insertOne(newFunding);
        res.json({ success: true, message: "Funding recorded successfully", id: result.insertedId });
      } catch (err) {
        console.error("Save funding error:", err);
        res.status(500).json({ message: "Failed to save funding" });
      }
    });

    // Fixed: This was causing 500 error due to duplicate/broken route above
    app.get("/fundings", async (req, res) => {
      try {
        const fundings = await fundingCollection
          .find({})
          .sort({ createdAt: -1 })
          .toArray();

        const totalResult = await fundingCollection.aggregate([
          { $group: { _id: null, totalFunding: { $sum: "$amount" } } }
        ]).toArray();

        const totalFunding = totalResult.length > 0 ? totalResult[0].totalFunding : 0;

        res.json({ fundings, totalFunding });
      } catch (err) {
        console.error("Error fetching fundings:", err);
        res.status(500).json({ fundings: [], totalFunding: 0 });
      }
    });

  } catch (error) {
    console.error("MongoDB connection error:", error);
  }
}

run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('Blood donation server is running');
});

app.listen(port, () => {
  console.log(`Blood server is running on port ${port}`);
});