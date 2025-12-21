const express = require('express')
const cors = require('cors');
const app = express()
require('dotenv').config();
const { MongoClient, ServerApiVersion } = require('mongodb');
const port = process.env.PORT || 3000

app.use(cors())
app.use(express.json())


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.vuj5cyn.mongodb.net/?appName=Cluster0`;
// Create a MongoClient with a MongoClientOptions object to set the Stable API version
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
    const userCollections = db.collection('users')
    const donorsCollection = db.collection('donors')
    const fundingsCollection = db.collection('fundings')

    app.get("/users", async (req, res) => {
      try {
        const total = await userCollections.countDocuments({});
        res.send({ totalUsers: total });
      } catch (err) {
        console.error("Users count error:", err);
        res.status(500).send({ totalUsers: 0 });
      }
    });


    app.post('/users', async(req,res)=>{
      const userInfo = req.body;
      userInfo.createdAt = new Date();
      userInfo.role = 'donor'
      const result = await userCollections.insertOne(userInfo);
      res.send(result)
    })

    // app.get("/users/role/:email", async (req, res) => {
    //   const { email } = req.params;
    //   try {
    //     const user = await userCollections.findOne(
    //       { email: email.toLowerCase().trim() },
    //       { projection: { role: 1, status: 1, _id: 0 } }
    //     );
    //     res.send({ role: user?.role || "donor", status: user?.status || "active" });
    //   } catch (err) {
    //     console.error("Role fetch error:", err);
    //     res.status(500).send({ role: "donor" });
    //   }
    // });

    // GET user role by email
app.get("/user/role/:email", async (req, res) => {
  try {
    const { email } = req.params;

    const user = await User.findOne({ email: email }); // MongoDB query (আপনার মডেল অনুযায়ী)

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({ role: user.role || "donor", status: user.status || "active" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

// Public route: Search donors
app.get("/search/donors", async (req, res) => {
  try {
    const { bloodGroup, district, upazila } = req.query;

    let query = { role: "donor", status: "active" };

    if (bloodGroup) query.bloodGroup = bloodGroup;
    if (district) query.district = district;
    if (upazila) query.upazila = upazila;

    const donors = await User.find(query).select(
      "name bloodGroup district upazila photoURL status"
    );

    res.json(donors);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});






    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);



app.get('/', (req, res) => {
  res.send('Blood donation server is running')
})

app.listen(port, () => {
  console.log(`Blood server is running on port ${port}`)
})
