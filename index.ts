import express, { NextFunction, Request, Response } from "express";
import { MongoClient, ObjectId } from "mongodb";
import cors from "cors";
import "dotenv/config";
import { createRemoteJWKSet, jwtVerify } from "jose";

const app = express();
const PORT = Number(process.env.PORT) || 8000;
const TIMEZONE = process.env.APP_TIMEZONE || "Asia/Dhaka";

const EVENT_TYPES = [
  "Cleanup",
  "Plantation",
  "Donation",
  "Food Relief",
  "Blood Drive",
  "Health Camp",
  "Education",
  "Other",
];

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

function cleanEvent(body: Record<string, unknown>, originalDate?: string) {
  const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const data = {
    title: s(body.title),
    description: s(body.description),
    eventType: s(body.eventType),
    thumbnail: s(body.thumbnail),
    location: s(body.location),
    eventDate: s(body.eventDate),
  };
  let error = "";
  if (data.title.length < 3) error = "Title must be at least 3 characters.";
  else if (data.description.length < 20)
    error = "Description must be at least 20 characters.";
  else if (!EVENT_TYPES.includes(data.eventType))
    error = "Pick a valid event type.";
  else if (!isUrl(data.thumbnail))
    error = "Thumbnail must be a valid http(s) image URL.";
  else if (data.location.length < 3) error = "Location is required.";
  else if (!/^\d{4}-\d{2}-\d{2}$/.test(data.eventDate))
    error = "Event date is invalid.";
  else if (data.eventDate !== originalDate && data.eventDate <= todayStr())
    error = "The event date must be in the future.";
  return { data, error };
}

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

// ---------- events ----------
app.post(
  "/add-event",
  verifyToken,
  h(async (req, res) => {
    const { data, error } = cleanEvent(req.body ?? {});
    if (error) return res.status(400).send({ msg: error });
    const { email, name } = res.locals.user;
    const result = await eventCollection.insertOne({
      ...data,
      email, // owner, taken from the verified token, never from the body
      organizer: name,
      participants: 0,
      createdAt: new Date().toISOString(),
    });
    res.send(result);
  }),
);

// Upcoming events only, optional ?q=search&type=Cleanup
app.get(
  "/events",
  h(async (req, res) => {
    const q = String(req.query.q ?? "").trim();
    const type = String(req.query.type ?? "").trim();
    const filter: Record<string, unknown> = {
      eventDate: { $gte: todayStr() },
    };
    if (type && type !== "All") filter.eventType = type;
    if (q) {
      const rx = { $regex: escapeRegex(q), $options: "i" };
      filter.$or = [{ title: rx }, { location: rx }];
    }
    const result = await eventCollection
      .find(filter)
      .sort({ eventDate: 1, _id: 1 })
      .toArray();
    res.send(result);
  }),
);

app.get(
  "/featured-events",
  h(async (req, res) => {
    const result = await eventCollection
      .find({ eventDate: { $gte: todayStr() } })
      .sort({ eventDate: 1, _id: 1 })
      .limit(6)
      .toArray();
    res.send(result);
  }),
);


app.get("/", (req, res) => {
  res.send({ message: "Server is running fine!" });
});

app.listen(PORT, () => {
  console.log(`Server is running at ${PORT}`);
});

export default app;
