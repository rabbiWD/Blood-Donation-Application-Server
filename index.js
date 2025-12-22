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

    // GET: Single donation request details (Details + Edit পেজের জন্য জরুরি!)
app.get("/donation-requests/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // ObjectId চেক করুন (যদি invalid ID হয়)
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid request ID" });
    }

    const request = await donationRequestsCollection.findOne({ _id: new ObjectId(id) });

    if (!request) {
      return res.status(404).json({ message: "Donation request not found" });
    }

    res.json(request);
  } catch (error) {
    console.error("Error fetching donation request:", error);
    res.status(500).json({ message: "Server error" });
  }
});

    // 7. CREATE Donation Request - plural করুন
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

// 8. GET: Single donation request - এটা যোগ করুন (জরুরি!)
app.get("/donation-request/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const request = await donationRequestsCollection.findOne({ _id: new ObjectId(id) });

    if (!request) {
      return res.status(404).json({ message: "Request not found" });
    }

    res.json(request);
  } catch (error) {
    console.error("Error fetching request:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// UPDATE: General update for donation request (for Edit page)
app.patch("/donation-request/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Optional: Allow only certain fields
    const allowedFields = [
      "recipientName",
      "hospitalName",
      "fullAddress",
      "bloodGroup",
      "district",
      "upazila",
      "donationDate",
      "donationTime",
      "requestMessage"
    ];

    const filteredUpdates = {};
    allowedFields.forEach(field => {
      if (updates[field] !== undefined) {
        filteredUpdates[field] = updates[field];
      }
    });

    if (Object.keys(filteredUpdates).length === 0) {
      return res.status(400).json({ message: "No valid fields to update" });
    }

    const result = await donationRequestsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: filteredUpdates }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ message: "Request not found" });
    }

    res.json({ message: "Request updated successfully" });
  } catch (error) {
    console.error("Error updating donation request:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// 9. Confirm donation - plural
app.patch("/donation-request/:id/donate", async (req, res) => {
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

// 10. Update status - plural
app.patch("/donation-request/:id/status", async (req, res) => {
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

// 11. Delete donation request - plural
app.delete("/donation-request/:id", async (req, res) => {
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

// Update user (status or role)
app.patch("/users/:email", async (req, res) => {
  try {
    const { email } = req.params;
    const updates = req.body; // { status: "blocked" } or { role: "admin" }

    const result = await userCollections.updateOne(
      { email },
      { $set: updates }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({ message: "User updated successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

// GET: All blood donation requests with pagination and filters (for Admin)
app.get("/all-blood-donation-request", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const { status, bloodGroup, district } = req.query;

    // Build query
    let query = {};

    if (status && status !== "") query.status = status;
    if (bloodGroup && bloodGroup !== "") query.bloodGroup = bloodGroup;
    if (district && district.trim() !== "") query.district = { $regex: new RegExp(district.trim(), "i") }; // case-insensitive partial match

    // Fetch total count for pagination
    const totalRequests = await donationRequestsCollection.countDocuments(query);

    // Fetch requests with sorting, skip, limit
    const requests = await donationRequestsCollection
      .find(query)
      .sort({ createdAt: -1 }) // newest first
      .skip(skip)
      .limit(limit)
      .toArray();

    // Prepare response
    const pagination = {
      currentPage: page,
      totalPages: Math.ceil(totalRequests / limit),
      totalRequests,
      hasNext: page < Math.ceil(totalRequests / limit),
      hasPrev: page > 1,
    };

    res.json({
      requests,
      pagination,
    });
  } catch (error) {
    console.error("Error fetching all donation requests:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Confirm donation - change status to inprogress
app.patch("/donation-requests/:id/donate", async (req, res) => {
  try {
    const { id } = req.params;
    const { donorName, donorEmail } = req.body;

    // Validate ID
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid request ID" });
    }

    const result = await donationRequestsCollection.updateOne(
      { _id: new ObjectId(id), status: "pending" }, // Only pending can be donated
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
      return res.status(404).json({ message: "Request not found or already donated" });
    }

    res.json({ message: "Donation confirmed successfully!" });
  } catch (error) {
    console.error("Error confirming donation:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// My Donation Requests - plural করুন
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

//     // 7. CREATE Donation Request
//     app.post("/donation-request", async (req, res) => {
//       try {
//         const requestData = req.body;
//         requestData.status = "pending";
//         requestData.createdAt = new Date();

//         const result = await donationRequestsCollection.insertOne(requestData);
//         res.status(201).json({ message: "Request created", id: result.insertedId });
//       } catch (error) {
//         console.error("Create request error:", error);
//         res.status(500).json({ message: "Server error" });
//       }
//     });

//     // CREATE Donation Request get
//   app.get("/donation-request/:id", async (req, res) => {
//   try {
//     const { id } = req.params;
//     const request = await donationRequestsCollection.findOne({ _id: new ObjectId(id) });

//     if (!request) {
//       return res.status(404).json({ message: "Request not found" });
//     }

//     res.json(request);
//   } catch (error) {
//     console.error("Error fetching request:", error);
//     res.status(500).json({ message: "Server error" });
//   }
// });

//     // 8. GET: My Donation Requests
//     app.get("/my-donation-request/:email", async (req, res) => {
//       try {
//         const { email } = req.params;
//         const limit = parseInt(req.query.limit) || 0;

//         let cursor = donationRequestsCollection
//           .find({ requesterEmail: email })
//           .sort({ createdAt: -1 })
//           .project({
//             recipientName: 1,
//             bloodGroup: 1,
//             district: 1,
//             upazila: 1,
//             donationDate: 1,
//             donationTime: 1,
//             status: 1,
//             donorName: 1,
//             donorEmail: 1
//           });

//         if (limit > 0) cursor = cursor.limit(limit);

//         const requests = await cursor.toArray();
//         res.json(requests);
//       } catch (error) {
//         console.error("Error fetching my requests:", error);
//         res.status(500).json({ message: "Server error" });
//       }
//     });

//     // 9. Confirm donation (inprogress)
//     app.patch("/donation-request/:id/donate", async (req, res) => {
//       try {
//         const { id } = req.params;
//         const { donorName, donorEmail } = req.body;

//         const result = await donationRequestsCollection.updateOne(
//           { _id: new ObjectId(id) },
//           {
//             $set: {
//               status: "inprogress",
//               donorName,
//               donorEmail,
//               donatedAt: new Date()
//             }
//           }
//         );

//         if (result.matchedCount === 0) {
//           return res.status(404).json({ message: "Request not found" });
//         }

//         res.json({ message: "Donation confirmed" });
//       } catch (error) {
//         console.error(error);
//         res.status(500).json({ message: "Server error" });
//       }
//     });

//     // 10. Update status (done / canceled)
//     app.patch("/donation-request/:id/status", async (req, res) => {
//       try {
//         const { id } = req.params;
//         const { status } = req.body;

//         const result = await donationRequestsCollection.updateOne(
//           { _id: new ObjectId(id) },
//           { $set: { status } }
//         );

//         if (result.matchedCount === 0) {
//           return res.status(404).json({ message: "Request not found" });
//         }

//         res.json({ message: "Status updated" });
//       } catch (error) {
//         console.error(error);
//         res.status(500).json({ message: "Server error" });
//       }
//     });

//     // 11. Delete donation request
//     app.delete("/donation-request/:id", async (req, res) => {
//       try {
//         const { id } = req.params;
//         const result = await donationRequestsCollection.deleteOne({ _id: new ObjectId(id) });

//         if (result.deletedCount === 0) {
//           return res.status(404).json({ message: "Request not found" });
//         }

//         res.json({ message: "Deleted successfully" });
//       } catch (error) {
//         console.error(error);
//         res.status(500).json({ message: "Server error" });
//       }
//     });

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