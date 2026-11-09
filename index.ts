import express, { NextFunction, Request, Response } from "express";
import { MongoClient, ObjectId } from "mongodb";
import cors from "cors";
import "dotenv/config";
import { createRemoteJWKSet, jwtVerify } from "jose";

const app = express();
const PORT = Number(process.env.PORT) || 8000;
const TIMEZONE = process.env.APP_TIMEZONE || "Asia/Dhaka";

const client = new MongoClient(process.env.MONGODB_URI as string);

export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.dir(err);
    throw err;
  }
}

app.use(cors());
app.use(express.json());

const mongoClient = await connectToMongoDB();
const db = mongoClient.db("bondhon");
const eventCollection = db.collection("events");
const joinCollection = db.collection("joinedEvents");


// ---------- helpers ----------
const JWKS = createRemoteJWKSet(
  new URL(`${process.env.CLIENT_URL}/api/auth/jwks`),
);

// Events are stored with a plain "YYYY-MM-DD" date, so string comparison works.
const todayStr = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: TIMEZONE });

const toId = (id: string) => (ObjectId.isValid(id) ? new ObjectId(id) : null);

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const isUrl = (v: string) => {
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
};

// Catches errors from async routes so one bad request never crashes the server.
const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
    (req: Request, res: Response, next: NextFunction) =>
      fn(req, res).catch((err) => {
        console.error(err);
        res.status(500).send({ msg: "Server Error!" });
      });

// ---------- auth (JWT issued by Better Auth on the client app) ----------
const verifyToken = async (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).send({ msg: "Unauthorized!" });
  }
  const token = authHeader.split(" ")[1];
  if (!token) {
    return res.status(401).send({ msg: "Unauthorized!" });
  }

  try {
    const { payload } = await jwtVerify(token, JWKS);
    if (!payload.email) {
      return res.status(401).send({ msg: "Unauthorized!" });
    }
    res.locals.user = {
      email: String(payload.email),
      name: String(payload.name ?? "Volunteer"),
    };
    next();
  } catch (error) {
    return res.status(401).send({ msg: "Invalid or expired token!" });
  }
};


app.get("/", (req, res) => {
  res.send({ message: "Server is running fine!" });
});

app.listen(PORT, () => {
  console.log(`Server is running at ${PORT}`);
});

export default app;
