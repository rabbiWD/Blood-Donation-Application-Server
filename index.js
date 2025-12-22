const express = require('express');
const cors = require('cors');
const app = express();
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
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
    await client.connect();

    const db = client.db('blood_db');
    const userCollections = db.collection('users');
    const donationRequestsCollection = db.collection('donation_requests');

    // 1. Total users count
    app.get("/users", async (req, res) => {
      try {
        const total = await userCollections.countDocuments({});
        res.json({ totalUsers: total });
      } catch (err) {
        console.error("Users count error:", err);
        res.status(500).json({ totalUsers: 0 });
      }
    });

    // 2. Create user (on registration)
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

    // 3. Get single user by email
    app.get("/users/:email", async (req, res) => {
      try {
        const { email } = req.params;
        const user = await userCollections.findOne({ email: email });

        if (!user) {
          return res.status(404).json({ message: "User not found" });
        }

        res.json(user);
      } catch (error) {
        console.error("Error fetching user:", error);
        res.status(500).json({ message: "Server error" });
      }
    });

    // 4. Update user profile - এখানে ভুল ঠিক করা হয়েছে
    app.patch("/users/:email", async (req, res) => {
      try {
        const { email } = req.params;
        const updates = req.body;

        // ইমেইল চেঞ্জ করা যাবে না
        delete updates.email;

        const result = await userCollections.updateOne(
          { email: email }, // <-- এখানে ঠিক করা হয়েছে
          { $set: updates }
        );

        if (result.matchedCount === 0) {
          return res.status(404).json({ message: "User not found" });
        }

        res.json({ message: "Profile updated successfully" });
      } catch (error) {
        console.error("Update profile error:", error);
        res.status(500).json({ 
          message: "Server error", 
          details: error.message 
        });
      }
    });

    // 5. Get user role & status
    app.get("/user/role/:email", async (req, res) => {
      try {
        const { email } = req.params;
        const user = await userCollections.findOne({ email: email });
        if (!user) {
          return res.status(404).json({ message: "User not found" });
        }
        res.json({ role: user.role || "donor", status: user.status || "active" });
      } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Server error" });
      }
    });

    // 6. Public: Search donors
    app.get("/search/donors", async (req, res) => {
      try {
        const { bloodGroup, district, upazila } = req.query;
        let query = { role: "donor", status: "active" };

        if (bloodGroup) query.bloodGroup = bloodGroup;
        if (district) query.district = district;
        if (upazila) query.upazila = upazila;

        const donors = await userCollections.find(query)
          .project({ name: 1, bloodGroup: 1, district: 1, upazila: 1, photoURL: 1, status: 1 })
          .toArray();

        res.json(donors);
      } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Server error" });
      }
    });

    // 7. CREATE Donation Request
    app.post("/donation-requests", async (req, res) => {
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

    // 8. GET: My Donation Requests
    app.get("/my-donation-requests/:email", async (req, res) => {
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

    // 9. Confirm donation (inprogress)
    app.patch("/donation-requests/:id/donate", async (req, res) => {
      try {
        const { id } = req.params;
        const { donorName, donorEmail } = req.body;

        const result = await donationRequestsCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: {
              status: "inprogress",
              donorName,
              donorEmail,
              donatedAt: new Date()
            }
          }
        );

        if (result.matchedCount === 0) {
          return res.status(404).json({ message: "Request not found" });
        }

        res.json({ message: "Donation confirmed" });
      } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Server error" });
      }
    });

    // 10. Update status (done / canceled)
    app.patch("/donation-requests/:id/status", async (req, res) => {
      try {
        const { id } = req.params;
        const { status } = req.body;

        const result = await donationRequestsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status } }
        );

        if (result.matchedCount === 0) {
          return res.status(404).json({ message: "Request not found" });
        }

        res.json({ message: "Status updated" });
      } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Server error" });
      }
    });

    // 11. Delete donation request
    app.delete("/donation-requests/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const result = await donationRequestsCollection.deleteOne({ _id: new ObjectId(id) });

        if (result.deletedCount === 0) {
          return res.status(404).json({ message: "Request not found" });
        }

        res.json({ message: "Deleted successfully" });
      } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Server error" });
      }
    });

    console.log("Successfully connected to MongoDB!");
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