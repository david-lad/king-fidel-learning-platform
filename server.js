const express = require("express");
const path = require("path");
const dotenv = require("dotenv");
const axios = require("axios");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const session = require("express-session");
const bodyParser = require("body-parser");
const geoip = require("geoip-lite");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const util = require("util");
const multer = require("multer");
const { getUploadUrl } = require("./r2");
const Busboy = require("busboy");
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} = require("@aws-sdk/client-s3");
const {
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const sendEmailOtp = require("./sendEmailOtp");
const { sendMail } = require("./mailer");
const {
  subscriptionCreated,
  adminTransactionNotification,
  otpLogin,
} = require("./email");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 1000;
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// ---------- Basic middleware ----------
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }, // secure: true only when behind HTTPS
  })
);
app.set("trust proxy", true);

// geoip middleware: attach req.clientCountry
app.use((req, res, next) => {
  try {
    let ip =
      req.headers["x-forwarded-for"] ||
      req.socket.remoteAddress ||
      req.connection?.remoteAddress;
    if (ip && ip.includes(",")) ip = ip.split(",")[0].trim();
    if (ip && ip.startsWith("::ffff:")) ip = ip.substring(7);
    const geo = geoip.lookup(ip);
    req.clientCountry = geo ? geo.country : "Unknown";
  } catch (e) {
    req.clientCountry = "Unknown";
  }
  next();
});

app.get("/", (req, res) => {
  res.redirect("/index");
});

app.get("/index", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/index.html", (req, res) => {
  return res.redirect("/index");
});

app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.get("/signup.html", (req, res) => {
  return res.redirect("/signup");
});

app.get("/signup", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "signup.html"));
});
app.get("/forgot", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "forgot.html"));
});

app.get("/forgot.html", (req, res) => {
  return res.redirect("/forgot");
});

app.get("/reset", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "reset.html"));
});

app.get("/reset.html", (req, res) => {
  return res.redirect("/reset");
});

app.get("/subscribe", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "subscribe.html"));
});

app.get("/subscribe.html", (req, res) => {
  return res.redirect(`/subscribe${req.params.redirect}`);
});

app.get("/manage_subscription", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "manage_subscription.html"));
});

app.get("/manage_subscription.html", (req, res) => {
  return res.redirect("/manage_subscription");
});

app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

if (!process.env.MONGO_URL) {
  console.error("MONGO_URL not set in environment! Exiting.");
  process.exit(1);
}

mongoose.connect(process.env.MONGO_URL, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});


const db = mongoose.connection;
db.on("error", console.error.bind(console, "MongoDB connection error:"));
db.once("open", () => console.log("✅ Connected to MongoDB"));


const userSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true },
    email: {
      type: String,
      unique: true,
      required: true,
      lowercase: true,
      trim: true,
    },
    phone: { type: String, unique: true, required: true, trim: true },
    passwordHash: { type: String, required: true },

    role: { type: String, default: "user", enum: ["user", "admin"] },
    isSubscribed: { type: Boolean, default: false },

    resetToken: String,
    resetTokenExpires: Date,
    pendingOtp: String,
    otpExpires: Date,

    activeSessions: [{ token: String, createdAt: Date, ip: String }],

    lastKnownCountry: String,

    subscriptionCurrency: String,
    subscriptionAmount: Number,
  },
  { timestamps: true }
);

userSchema.methods.setPassword = async function (password) {
  this.passwordHash = await bcrypt.hash(password, 10);
};

userSchema.methods.validatePassword = function (password) {
  return bcrypt.compare(password, this.passwordHash);
};

const User = mongoose.model("User", userSchema);

const otpSchema = new mongoose.Schema({
  email: { type: String, required: true },
  otp: { type: String, required: true },
  expiresAt: { type: Date, required: true },
});
const Otp = mongoose.model("Otp", otpSchema);

const episodeSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: String,
  videoKey: String, // R2 key or S3 key (not signed URL)
  thumbnailKey: String, // R2 key for thumbnail
  order: { type: Number, required: true }, 
  duration: Number, 
  createdAt: { type: Date, default: Date.now },
});

const courseSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: String,
  thumbnailKey: String, 
  slug: String,
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  episodes: [episodeSchema], 
  createdAt: { type: Date, default: Date.now },
  updatedAt: Date,
});

const Course = mongoose.model("Course", courseSchema);

const episodeProgressSchema = new mongoose.Schema({
  episodeOrder: Number,
  completedAt: Date,
});

const enrollmentSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  course: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Course",
    required: true,
  },
  enrolledAt: { type: Date, default: Date.now },
  progress: [episodeProgressSchema], // completed episodes
  lastAccessedEpisodeOrder: { type: Number, default: -1 }, 
});

enrollmentSchema.index({ user: 1, course: 1 }, { unique: true });

const Enrollment = mongoose.model("Enrollment", enrollmentSchema);


function requireAdmin(req, res, next) {
  if (req.session.user && req.session.user.role === "admin") {
    return next();
  }
  return res.status(403).send("Forbidden");
}

function requireSubscription(req, res, next) {
  if (
    req.session.user &&
    (req.session.user.isSubscribed || req.session.user.role === "admin")
  ) {
    return next();
  } else if (req.session.user && !req.session.user.isSubscribed) {
    return res.redirect(`/subscribe?redirect=${req.originalUrl}`);
  }
  return res.redirect(`/login?redirect=${req.originalUrl}`);
}


const unlinkAsync = util.promisify(fs.unlink);


let s3Client = null;
let r2Public = null;
if (
  process.env.R2_ACCESS_KEY_ID &&
  process.env.R2_SECRET_ACCESS_KEY &&
  process.env.CLOUDFLARE_ACCOUNT_ID
) {
  s3Client = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
 
  r2Public = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
  console.log("R2 S3 clients configured.");
} else {
  console.warn(
    "R2 env vars not configured; upload & signed URL features will not work until set."
  );
}

// Delete from private bucket (videos)
async function deleteVideoFromBucket(key) {
  if (!key || !s3Client) return;
  try {
    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: key,
      })
    );
    console.log(`Deleted video ${key} from private bucket`);
  } catch (err) {
    console.error(`Failed to delete video ${key}:`, err);
  }
}

// Delete from public bucket (thumbnails)
async function deleteThumbnailFromBucket(key) {
  if (!key || !r2Public) return;
  try {
    await r2Public.send(
      new DeleteObjectCommand({
        Bucket: process.env.R2_PUBLIC_BUCKET_NAME, 
        Key: key,
      })
    );
    console.log(`Deleted thumbnail ${key} from public bucket`);
  } catch (err) {
    console.error(`Failed to delete thumbnail ${key}:`, err);
  }
}


function getPublicUrl(key) {
  if (!key) return null;
  const base = process.env.R2_PUBLIC_BASE_URL;
  if (base) {
    return `${base.replace(/\/$/, "")}/${encodeURIComponent(key)}`;
  }
  if (process.env.CLOUDFLARE_ACCOUNT_ID) {
    return `https://${
      process.env.CLOUDFLARE_ACCOUNT_ID
    }.r2.dev/${encodeURIComponent(key)}`;
  }
  return `/r2/${encodeURIComponent(key)}`;
}
async function uploadToR2WithRetry(key, filePath, contentType, maxRetries = 3) {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      await uploadToR2FromFile(key, filePath, contentType); 
      return; // success
    } catch (err) {
      attempt++;
      if (attempt >= maxRetries) throw err;
      const backoff = Math.pow(2, attempt) * 500; 
      console.warn(
        `Upload failed (attempt ${attempt}), retrying in ${backoff}ms...`
      );
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
}

async function uploadToR2FromFile(
  key,
  filePath,
  contentType = "application/octet-stream"
) {
  if (!s3Client) throw new Error("R2 client not configured");
  const fileStream = fs.createReadStream(filePath);
  const cmd = new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: key,
    Body: fileStream,
    ContentType: contentType,
  });
  await s3Client.send(cmd);
  return key;
}

async function uploadBufferToR2Public(
  key,
  buffer,
  contentType = "application/octet-stream"
) {
  if (!r2Public) throw new Error("R2 public client not configured");
  const cmd = new PutObjectCommand({
    Bucket: process.env.R2_PUBLIC_BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  });
  await r2Public.send(cmd);
  return key;
}

async function getSignedVideoUrl(key, expiresInSeconds = 60*30) {
  if (!s3Client) throw new Error("R2 client not configured");
  const cmd = new GetObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: key,
  });
  const url = await getSignedUrl(s3Client, cmd, {
    expiresIn: expiresInSeconds,
  });
  return url;
}

// ---------- Multer for streaming large uploads ----------
const tmpDir = path.join(os.tmpdir(), "kingfidel_uploads");
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, tmpDir);
  },
  filename: function (req, file, cb) {
    const safeName = (file.originalname || "upload").replace(
      /[^a-zA-Z0-9-_\.]/g,
      "_"
    );
    cb(null, `${Date.now()}_${safeName}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 1024 * 1024 * 1024 * 2 },
}); 

// Multer for small uploads 
const memoryStorage = multer.memoryStorage();
const uploadMemory = multer({
  storage: memoryStorage,
  limits: { fileSize: 20 * 1024 * 1024 }, 
});
const slugify = (text) => {
  return text
    .toString()
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-") 
    .replace(/[^\w\-]+/g, "") 
    .replace(/\-\-+/g, "-"); 
};

app.post("/api/register", async (req, res) => {
  try {
    const { fullName, email, phone, password } = req.body;

    const existingUser = await User.findOne({
      $or: [{ email: email.toLowerCase().trim() }, { phone: phone.trim() }],
    });

    if (existingUser) {
      return res
        .status(400)
        .json({ error: "A user with this email or phone already exists" });
    }

    let role = "user";
    let isSubscribed = false;
    if (ADMIN_EMAILS.includes(email)) {
      role = "admin";
      isSubscribed = true;
    }


    let ip = req.headers["x-forwarded-for"];
    if (ip) {
      ip = ip.split(",")[0].trim();
    } else {
      ip =
        req.connection?.remoteAddress ||
        req.socket?.remoteAddress ||
        (req.connection?.socket ? req.connection.socket.remoteAddress : null);
    }
    if (ip && ip.startsWith("::ffff:")) {
      ip = ip.substring(7);
    }

    const geo = geoip.lookup(ip);
    const country = geo ? geo.country : "Unknown";
    req.clientCountry = country;

    const user = new User({
      fullName,
      email: email.toLowerCase().trim(),
      phone: phone.trim(),
      role,
      isSubscribed,
      lastKnownCountry: country,
    });

    await user.setPassword(password);
    await user.save();

    req.session.user = { id: user._id, email: user.email, role, isSubscribed };

    res.json({ message: "Registered", country });
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email: email.toLowerCase().trim() });
  if (!user) return res.status(401).send({ message: "Invalid credentials" });

  const isValid = await user.validatePassword(password);
  if (!isValid) return res.status(401).send({ message: "Invalid credentials" });

  if (
    user.isSubscribed &&
    user.role === "user" &&
    user.email !== "example@test.com"
  ) {
    const otp = crypto.randomInt(100000, 999999).toString();
    user.pendingOtp = otp;
    user.otpExpires = Date.now() + 5 * 60 * 1000; // 5 min expiry
    await user.save();

    try {
      await sendMail({
        to: user.email,
        subject: "Your King Fidel Login OTP",
        html: otpLogin(user.fullName, otp),
      });
    } catch (err) {
      console.error("Error sending OTP email:", err);
    }

    return res.json({ status: "otp_required", email: user.email });
  }

  // Normal login:
  const sessionToken = crypto.randomBytes(16).toString("hex");
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;

  user.activeSessions = user.activeSessions.filter((s) => !!s.token);

  user.activeSessions.unshift({
    token: sessionToken,
    createdAt: new Date(),
    ip,
  });

  //  trim to only the most recent 2
  user.activeSessions = user.activeSessions.slice(0, 2);

  await user.save();

  req.session.user = {
    id: user._id,
    email: user.email,
    role: user.role,
    isSubscribed: user.isSubscribed,
    fullName: user.fullName,
    token: sessionToken,
  };

  res.json({ status: "ok", country: user.lastKnownCountry, redirect: req.body.redirect });
});

app.post("/api/verify-otp", async (req, res) => {
  const { email, otp } = req.body;
  const user = await User.findOne({ email: email.toLowerCase().trim() });
  if (!user || !user.pendingOtp) return res.status(400).send("Invalid OTP");

  if (Date.now() > user.otpExpires || user.pendingOtp !== otp) {
    user.pendingOtp = null;
    await user.save();
    return res.status(400).send("Invalid or expired OTP");
  }

  user.pendingOtp = null;
  user.otpExpires = null;

  const sessionToken = crypto.randomBytes(16).toString("hex");
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
  user.activeSessions.unshift({
    token: sessionToken,
    createdAt: new Date(),
    ip,
  });
  user.activeSessions = user.activeSessions.slice(0, 2);
  await user.save();

  req.session.user = {
    id: user._id,
    email: user.email,
    role: user.role,
    isSubscribed: user.isSubscribed,
    fullName: user.fullName,
    token: sessionToken,
  };

  res.json({ status: "ok" });
});

app.post("/api/logout", async (req, res) => {
  if (req.session.user) {
    const user = await User.findById(req.session.user.id);
    if (user) {
      user.activeSessions = user.activeSessions.filter(
        (s) => s.token !== req.session.user.token
      );
      await user.save();
    }
  }
  req.session.destroy(() => res.json({ message: "Logged out" }));
});

app.post("/api/forgot-password", async (req, res) => {
  const { email } = req.body;
  const user = await User.findOne({ email });
  if (!user)
    return res.status(200).send("If that email exists, a code was sent.");

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  await Otp.deleteMany({ email });
  await Otp.create({ email, otp, expiresAt });

  try {
    await sendEmailOtp(email, otp);
    res.status(200).send("Check your email for your OTP code");
  } catch (err) {
    console.error(err);
    res.status(500).send("Could not send email");
  }
});

app.post("/reset-password/:token", async (req, res) => {
  const user = await User.findOne({
    resetToken: req.params.token,
    resetTokenExpires: { $gt: Date.now() },
  });
  if (!user) return res.status(400).send("Token invalid or expired");

  await user.setPassword(req.body.password);
  user.resetToken = undefined;
  user.resetTokenExpires = undefined;
  await user.save();
  res.send("Password reset successful");
});

app.post("/api/reset-password", async (req, res) => {
  const { email, otp, newPassword } = req.body;

  try {
    const otpRecord = await Otp.findOne({ email, otp });
    if (!otpRecord) {
      return res.status(400).json({ error: "Invalid OTP" });
    }

    if (otpRecord.expiresAt < new Date()) {
      return res.status(400).json({ error: "OTP expired" });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    await user.setPassword(newPassword);
    await user.save();

    await Otp.deleteOne({ _id: otpRecord._id });

    res.json({ message: "Password reset successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});


app.get("/admin", requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.get("/courses/:id", requireSubscription, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "courses.html"));
});

app.post("/admin/courses", requireAdmin, async (req, res) => {
  const { title, description, thumbnailKey } = req.body;
  const slug = slugify(title);
  let exists = await Course.findOne({ slug });
  if (exists) slug += "-" + Date.now();
  try {
    const course = new Course({
      title,
      description,
      thumbnailKey,
      slug,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: req.session.user ? req.session.user.id : undefined,
    });
    await course.save();
    res.json(course);
  } catch (err) {
    console.error("Error saving course:", err);
    res.status(500).send("Error saving course");
  }
});

app.get("/api/courses", async (req, res) => {
  try {
    const courses = await Course.find().sort({ createdAt: -1 }).lean();

    const transformed = courses.map((c) => {
      const courseCopy = { ...c };
      courseCopy.thumbnailPublicUrl = getPublicUrl(c.thumbnailKey);
      courseCopy.episodeCount = (c.episodes || []).length;
      return courseCopy;
    });

    res.json(transformed);
  } catch (err) {
    console.error("Error fetching courses:", err);
    res.status(500).send("Server error");
  }
});

app.put("/admin/courses/:id", requireAdmin, async (req, res) => {
  try {
    const { title, description, thumbnailKey } = req.body;
    const course = await Course.findById(req.params.id);
    if (!course) return res.status(404).send("Course not found");
    if (
      thumbnailKey &&
      course.thumbnailKey &&
      course.thumbnailKey !== thumbnailKey
    ) {
      await deleteThumbnailFromBucket(course.thumbnailKey);
    }

    course.title = title || course.title;
    course.description = description || course.description;
    course.thumbnailKey = thumbnailKey || course.thumbnailKey;
    course.slug = slugify(title);
    course.updatedAt = new Date();

    await course.save();
    res.json(course);
  } catch (err) {
    console.error("Update course error:", err);
    res.status(500).send("Server error");
  }
});

app.delete("/admin/courses/:id", requireAdmin, async (req, res) => {
  try {
    const course = await Course.findByIdAndDelete(req.params.id);
    if (course) {
      if (
        course.thumbnailKey &&
        r2Public &&
        process.env.R2_PUBLIC_BUCKET_NAME
      ) {
        try {
          const delThumb = new DeleteObjectCommand({
            Bucket: process.env.R2_PUBLIC_BUCKET_NAME,
            Key: course.thumbnailKey,
          });
          await r2Public.send(delThumb);
        } catch (e) {
          console.error("Error deleting public course thumbnail:", e);
        }
      }

      for (const ep of course.episodes || []) {
        if (ep.videoKey && s3Client && process.env.R2_BUCKET_NAME) {
          try {
            const delVid = new DeleteObjectCommand({
              Bucket: process.env.R2_BUCKET_NAME,
              Key: ep.videoKey,
            });
            await s3Client.send(delVid);
          } catch (e) {
            console.error("Error deleting episode video:", e);
          }
        }
        if (ep.thumbnailKey && r2Public && process.env.R2_PUBLIC_BUCKET_NAME) {
          try {
            const delEpThumb = new DeleteObjectCommand({
              Bucket: process.env.R2_PUBLIC_BUCKET_NAME,
              Key: ep.thumbnailKey,
            });
            await r2Public.send(delEpThumb);
          } catch (e) {
            console.error("Error deleting episode thumbnail:", e);
          }
        }
      }
    }
    res.json({ message: "Course deleted" });
  } catch (err) {
    console.error("Delete course error:", err);
    res.status(500).send("Server error");
  }
});

app.get("/me", async (req, res) => {
  const sessionUser = req.session.user;
  if (!sessionUser) return res.status(401).json({ error: "Not logged in" });

  try {
    const user = await User.findById(sessionUser.id);
    if (!user) return res.status(401).json({ error: "Not logged in" });

    const stillActive = user.activeSessions.some(
      (s) => s.token === sessionUser.token
    );
    if (!stillActive) {
      req.session.destroy(() => {});
      return res
        .status(401)
        .json({ error: "Session expired. Please log in again." });
    }

    if (
      req.clientCountry &&
      req.clientCountry !== "Unknown" &&
      req.clientCountry !== user.lastKnownCountry
    ) {
      user.lastKnownCountry = req.clientCountry;
      await user.save();
    }

    res.json({
      id: user._id,
      email: user.email,
      fullName: user.fullName,
      phone: user.phone,
      role: user.role,
      isSubscribed: user.isSubscribed,
      country: user.lastKnownCountry || req.clientCountry || "Unknown",
    });
  } catch (err) {
    console.error("/me error:", err);
    res.status(500).send("Server error");
  }
});

app.post(
  "/admin/upload-video",
  requireAdmin,
  upload.single("video"),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).send("No file uploaded");
      if (!s3Client) return res.status(500).send("R2 not configured on server");

      const originalName = req.file.originalname || "video";
      const safeName = originalName.replace(/[^a-zA-Z0-9-_.]/g, "_");
      const key = `videos/${Date.now()}_${safeName}`;
      const filePath = req.file.path;
      const contentType = req.file.mimetype || "application/octet-stream";

      // upload to R2
      try {
        await uploadToR2WithRetry(key, filePath, contentType);
      } catch (err) {
        console.error("R2 upload error:", err);
        try {
          await unlinkAsync(filePath);
        } catch (e) {}
        return res.status(500).send("Upload to storage failed");
      }

      try {
        await unlinkAsync(filePath);
      } catch (e) {}

      const previewUrl = await getSignedVideoUrl(key, 300); // 5 minutes
      res.json({ key, previewUrl });
    } catch (err) {
      console.error("Upload error:", err);
      res.status(500).send("Upload failed");
    }
  }
);

app.post(
  "/admin/presign-upload",
  requireAdmin,
  express.json(),
  async (req, res) => {
    try {
      if (!s3Client) return res.status(500).send("R2 not configured on server");
      const { filename, contentType } = req.body;
      if (!filename) return res.status(400).send("Missing filename");

      const safeName = filename.replace(/[^a-zA-Z0-9-_.]/g, "_");
      const key = `videos/${Date.now()}_${safeName}`;

      const cmd = new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: key,
        ContentType: contentType || "application/octet-stream",
      });

      const signedPutUrl = await getSignedUrl(s3Client, cmd, {
        expiresIn: 30,
      }); 
      res.json({ key, signedPutUrl });
    } catch (err) {
      console.error("Presign upload error:", err);
      res.status(500).send("Could not generate upload URL");
    }
  }
);

app.post("/flw-webhook", express.json(), async (req, res) => {
  try {
    const signature = req.headers["verif-hash"];
    if (!signature || signature !== process.env.FLW_SECRET_HASH) {
      return res.status(401).send("Invalid signature");
    }

    const event = req.body;
    const data = event.data;
    const customerEmail = data?.customer?.email;
    if (!customerEmail) {
      console.log("No customer email in event");
      return res.status(400).send("Missing email");
    }

    const user = await User.findOne({
      email: customerEmail.toLowerCase().trim(),
    });
    if (!user) {
      console.log("User not found for email:", customerEmail);
      return res.status(404).send("User not found");
    }

    if (
      event.event === "subscription.created" ||
      event.event === "charge.completed" ||
      event.event === "payment.completed"
    ) {
      const txRef = data.tx_ref || "";

      if (txRef.startsWith("sub_")) {
        user.isSubscribed = true;
        user.subscriptionCurrency = data.currency || user.subscriptionCurrency;
        user.subscriptionAmount = data.amount || user.subscriptionAmount;
        await user.save();

        // send only the subscription created email
        const emailData = subscriptionCreated(user.fullName);
        try {
          await sendMail({
            to: user.email,
            subject: emailData.subject,
            html: emailData.html,
          });
          console.log(`[EMAIL SENT] Subscription mail sent to ${user.email}`);
        } catch (err) {
          console.error(
            `[EMAIL ERROR] Failed to send mail to ${user.email}:`,
            err
          );
        }

        console.log("Updated user subscription for:", customerEmail);
        return res.json({ status: "ok" });
      }
      const adminEmailData = adminTransactionNotification({
        customerName: user.fullName,
        customerEmail: user.email,
        amount: data.amount,
        currency: data.currency,
        tx_ref: txRef,
        type: data.tx_ref.startsWith("sub_") ? "Subscription" : "Product/Ebook",
        date: Date.now(),
      });

      await sendMail({
        to: process.env.USER_EMAIL, 
        subject: adminEmailData.subject,
        html: adminEmailData.html,
      });
    }

    return res.json({ status: "ignored" });
  } catch (err) {
    console.error("Webhook error:", err);
    res.status(500).send("Server error");
  }
});


app.post("/admin/courses/:id/episodes", requireAdmin, async (req, res) => {
  try {
    const { title, description, videoKey, thumbnailKey, order, duration } =
      req.body;
    const course = await Course.findById(req.params.id);
    if (!course) return res.status(404).send("Course not found");

    // ensure unique order index
    if (course.episodes.some((ep) => ep.order === order)) {
      return res.status(400).send("Episode order already exists");
    }

    course.episodes.push({
      title,
      description,
      videoKey,
      thumbnailKey,
      order,
      duration,
    });
    course.updatedAt = new Date();
    await course.save();
    res.json(course);
  } catch (err) {
    console.error("Add episode error:", err);
    res.status(500).send("Server error");
  }
});


app.put("/admin/courses/:courseId/episodes/:episodeId", async (req, res) => {
  try {
    const { courseId, episodeId } = req.params;
    const { title, description, order, videoKey, thumbnailKey } = req.body;

    const course = await Course.findById(courseId);
    if (!course) return res.status(404).json({ error: "Course not found" });

    const episode = course.episodes.id(episodeId);
    if (!episode) return res.status(404).json({ error: "Episode not found" });

    // Prevent duplicate order
    if (order !== undefined) {
      const duplicate = course.episodes.find(
        (ep) => ep.order === order && ep._id.toString() !== episodeId
      );
      if (duplicate)
        return res
          .status(400)
          .json({ error: `Episode order ${order} already exists` });
      episode.order = order;
    }

    if (title) episode.title = title;
    episode.description = description || "";

    if (videoKey && episode.videoKey && episode.videoKey !== videoKey) {
      await deleteVideoFromBucket(episode.videoKey);
      episode.videoKey = videoKey;
    }

    if (
      thumbnailKey &&
      episode.thumbnailKey &&
      episode.thumbnailKey !== thumbnailKey
    ) {
      await deleteThumbnailFromBucket(episode.thumbnailKey);
      episode.thumbnailKey = thumbnailKey;
    }

    await course.save();
    res.json({ message: "Episode updated successfully", episode });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.delete(
  "/admin/courses/:id/episodes/:order",
  requireAdmin,
  async (req, res) => {
    try {
      const course = await Course.findById(req.params.id);
      if (!course) return res.status(404).send("Course not found");
      const order = parseInt(req.params.order, 10);
      const ep = course.episodes.find((e) => e.order === order);
      if (!ep) return res.status(404).send("Episode not found");

      if (s3Client && process.env.R2_BUCKET_NAME && ep.videoKey) {
        try {
          const delVid = new DeleteObjectCommand({
            Bucket: process.env.R2_BUCKET_NAME,
            Key: ep.videoKey,
          });
          await s3Client.send(delVid);
        } catch (e) {
          console.error("Error deleting episode video:", e);
        }
      }
      if (r2Public && process.env.R2_PUBLIC_BUCKET_NAME && ep.thumbnailKey) {
        try {
          const delThumb = new DeleteObjectCommand({
            Bucket: process.env.R2_PUBLIC_BUCKET_NAME,
            Key: ep.thumbnailKey,
          });
          await r2Public.send(delThumb);
        } catch (e) {
          console.error("Error deleting episode thumbnail:", e);
        }
      }

      course.episodes = course.episodes.filter((e) => e.order !== order);
      course.updatedAt = new Date();
      await course.save();
      res.json(course);
    } catch (err) {
      console.error("Delete episode error:", err);
      res.status(500).send("Server error");
    }
  }
);


app.get("/api/courses/:id", async (req, res) => {
  try {
    const course = await Course.findById(req.params.id).lean();
    if (!course) return res.status(404).send("Course not found");

    let progressOrders = [];
    if (req.session.user) {
      const enrollment = await Enrollment.findOne({
        user: req.session.user.id,
        course: course._id,
      });
      if (enrollment) {
        progressOrders = enrollment.progress.map((p) => p.episodeOrder);
      }
    }

    const episodesWithLock = (course.episodes || [])
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((ep) => {
        const isCompleted = progressOrders.includes(ep.order);
        const unlocked =
          ep.order === 0 || progressOrders.includes(ep.order - 1);
        return {
          _id: ep._id,
          title: ep.title,
          description: ep.description,
          thumbnailKey: ep.thumbnailKey,
          thumbnailPublicUrl: getPublicUrl(ep.thumbnailKey),
          order: ep.order,
          duration: ep.duration,
          completed: isCompleted,
          locked: !unlocked,
        };
      });

    res.json({
      id: course._id,
      title: course.title,
      description: course.description,
      thumbnailKey: course.thumbnailKey,
      thumbnailPublicUrl: getPublicUrl(course.thumbnailKey),
      createdBy: course.createdBy,
      createdAt: course.createdAt,
      updatedAt: course.updatedAt,
      episodes: episodesWithLock,
    });
  } catch (err) {
    console.error("Get course error:", err);
    res.status(500).send("Server error");
  }
});

app.get("/admin/courses/:id/episodes", requireAdmin, async (req, res) => {
  try {
    const course = await Course.findById(req.params.id);
    if (!course) return res.status(404).json([]);
    // sort episodes by order
    const episodes = (course.episodes || []).sort((a, b) => a.order - b.order);
    res.json(episodes);
  } catch (err) {
    console.error(err);
    res.status(500).json([]);
  }
});

app.post("/admin/courses/:id/episodes", requireAdmin, async (req, res) => {
  try {
    const course = await Course.findById(req.params.id);
    if (!course) return res.status(404).send("Course not found");
    const { title, description, order, videoKey, thumbnailKey } = req.body;
    course.episodes.push({ title, description, order, videoKey, thumbnailKey });
    course.updatedAt = new Date();
    await course.save();
    res.json(course);
  } catch (err) {
    console.error("Add episode error:", err);
    res.status(500).send("Server error");
  }
});


app.get(
  "/api/courses/:id/episodes/:order",
  requireSubscription,
  async (req, res) => {
    try {
      const course = await Course.findById(req.params.id);
      if (!course) return res.status(404).send("Course not found");

      const order = parseInt(req.params.order, 10);

      const orders = (course.episodes || []).map((e) => e.order);
      const firstOrder = orders.length ? Math.min(...orders) : 0;

      let enrollment = await Enrollment.findOne({
        user: req.session.user.id,
        course: course._id,
      });

      if (!enrollment) {
        enrollment = new Enrollment({
          user: req.session.user.id,
          course: course._id,
          progress: [],
        });
        await enrollment.save();
      }

      const prevCompleted =
        order === firstOrder ||
        enrollment.progress.some((p) => p.episodeOrder === order - 1);

      if (!prevCompleted) {
        return res.status(403).send("You must complete previous episode first");
      }

      const ep = course.episodes.find((e) => e.order === order);
      if (!ep) return res.status(404).send("Episode not found");

      if (!s3Client)
        return res.status(500).send("Video serving not configured (no R2)");
      if (!ep.videoKey)
        return res.status(404).send("Video not found for episode");

      const signedUrl = await getSignedVideoUrl(ep.videoKey, 60*30);

      res.json({
        signedUrl,
        episode: {
          title: ep.title,
          description: ep.description,
          order: ep.order,
          duration: ep.duration,
          thumbnailKey: ep.thumbnailKey,
          thumbnailPublicUrl: getPublicUrl(ep.thumbnailKey),
        },
      });
    } catch (err) {
      console.error(err);
      res.status(500).send("Server error");
    }
  }
);

app.get("/api/courses/:id/episodes", requireSubscription, async (req, res) => {
  try {
    const course = await Course.findById(req.params.id);
    if (!course) return res.status(404).send("Course not found");

    // find enrollment or auto-create it
    let enrollment = await Enrollment.findOne({
      user: req.session.user.id,
      course: course._id,
    });

    if (!enrollment) {
      enrollment = new Enrollment({
        user: req.session.user.id,
        course: course._id,
        progress: [],
      });
      await enrollment.save();
    }

    // completed episodes
    const completedOrders = enrollment.progress.map((p) => p.episodeOrder);
    const highestCompleted = completedOrders.length
      ? Math.max(...completedOrders)
      : -1;

    const episodesWithLock = course.episodes.map((ep) => ({
      order: ep.order,
      title: ep.title,
      description: ep.description,
      duration: ep.duration,
      thumbnailKey: ep.thumbnailKey,
      thumbnailPublicUrl: getPublicUrl(ep.thumbnailKey),
      completed: completedOrders.includes(ep.order),
      locked: ep.order > (highestCompleted === -1 ? 1 : highestCompleted + 1), // locked beyond next
    }));

    res.json({
      episodes: episodesWithLock,
      progress: completedOrders,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});

app.post(
  "/api/courses/:id/episodes/:order/complete",
  requireSubscription,
  async (req, res) => {
    try {
      const course = await Course.findById(req.params.id);
      if (!course) return res.status(404).send("Course not found");

      const order = parseInt(req.params.order, 10);

      let enrollment = await Enrollment.findOne({
        user: req.session.user.id,
        course: course._id,
      });

      if (!enrollment) {
        enrollment = new Enrollment({
          user: req.session.user.id,
          course: course._id,
          progress: [],
        });
      }

      if (!enrollment.progress.some((p) => p.episodeOrder === order)) {
        enrollment.progress.push({
          episodeOrder: order,
          completedAt: new Date(),
        });
      }

      enrollment.lastAccessedEpisodeOrder = order;
      await enrollment.save();

      res.json({ message: `Episode ${order} marked completed` });
    } catch (err) {
      console.error("Complete episode error:", err);
      res.status(500).send("Server error");
    }
  }
);

app.post(
  "/admin/upload-episode-video",
  requireAdmin,
  upload.single("video"),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).send("No file uploaded");
      if (!s3Client) return res.status(500).send("R2 not configured on server");
      const originalName = req.file.originalname || "episode_video";
      const safeName = originalName.replace(/[^a-zA-Z0-9-_.]/g, "_");
      const key = `episodes/videos/${Date.now()}_${safeName}`;
      const filePath = req.file.path;
      const contentType = req.file.mimetype || "application/octet-stream";

      try {
        await uploadToR2WithRetry(key, filePath, contentType);
      } catch (err) {
        console.error("R2 upload error:", err);
        try {
          await unlinkAsync(filePath);
        } catch (e) {}
        return res.status(500).send("Upload to storage failed");
      }

      try {
        await unlinkAsync(filePath);
      } catch (e) {}
      const previewUrl = await getSignedVideoUrl(key, 300); // 5 minutes
      res.json({ key, previewUrl });
    } catch (err) {
      console.error("Upload episode video error:", err);
      res.status(500).send("Upload failed");
    }
  }
);

app.post(
  "/admin/upload-episode-thumbnail",
  requireAdmin,
  uploadMemory.single("thumbnail"),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).send("No file uploaded");
      if (!r2Public)
        return res.status(500).send("R2 public client not configured");

      const originalName = req.file.originalname || "episode_thumb";
      const safeName = originalName.replace(/[^a-zA-Z0-9-_.]/g, "_");
      const key = `episodes/thumbnails/${Date.now()}_${safeName}`;
      const buffer = req.file.buffer;
      const contentType = req.file.mimetype || "image/png";

      try {
        await uploadBufferToR2Public(key, buffer, contentType);
      } catch (err) {
        console.error("R2 public upload error:", err);
        return res.status(500).send("Upload to public bucket failed");
      }

      res.json({ key, publicUrl: getPublicUrl(key) });
    } catch (err) {
      console.error("Upload episode thumbnail error:", err);
      res.status(500).send("Upload failed");
    }
  }
);
app.post(
  "/admin/multipart/start-video-upload",
  requireAdmin,
  async (req, res) => {
    try {
      const { filename, contentType } = req.body;
      if (!filename) return res.status(400).send("filename required");

      const safeName = filename.replace(/[^a-zA-Z0-9-_.]/g, "_");
      const key = `episodes/videos/${Date.now()}_${safeName}`;

      const { UploadId } = await s3Client.send(
        new CreateMultipartUploadCommand({
          Bucket: process.env.R2_BUCKET_NAME,
          Key: key,
          ContentType: contentType || "application/octet-stream",
        })
      );

      res.json({ key, uploadId: UploadId });
    } catch (err) {
      console.error("Start multipart error:", err);
      res.status(500).send("Could not start multipart upload");
    }
  }
);

app.post("/admin/multipart/upload-part", requireAdmin, async (req, res) => {
  const busboy = Busboy({ headers: req.headers });
  let key, uploadId, partNumber;
  let chunks = [];

  busboy.on("field", (name, val) => {
    if (name === "key") key = val;
    if (name === "uploadId") uploadId = val;
    if (name === "partNumber") partNumber = parseInt(val, 10);
  });

  busboy.on("file", (fieldname, file, filename, encoding, mimetype) => {
    file.on("data", (data) => chunks.push(data));
    file.on("end", async () => {
      try {
        const body = Buffer.concat(chunks);

        const { ETag } = await s3Client.send(
          new UploadPartCommand({
            Bucket: process.env.R2_BUCKET_NAME,
            Key: key,
            UploadId: uploadId,
            PartNumber: partNumber,
            Body: body,
          })
        );

        res.json({ ETag });
      } catch (err) {
        console.error("Upload part error:", err);
        res.status(500).send("Upload part failed");
      }
    });
  });

  req.pipe(busboy);
});

app.post(
  "/admin/multipart/complete-video-upload",
  requireAdmin,
  async (req, res) => {
    try {
      const { key, uploadId, parts } = req.body;

      const out = await s3Client.send(
        new CompleteMultipartUploadCommand({
          Bucket: process.env.R2_BUCKET_NAME,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: { Parts: parts },
        })
      );

      res.json({
        key,
        location:
          out.Location ||
          `https://${process.env.R2_BUCKET_NAME}.r2.cloudflarestorage.com/${key}`,
      });
    } catch (err) {
      console.error("Complete multipart error:", err);
      res.status(500).send("Could not complete upload");
    }
  }
);

app.post("/admin/multipart/abort", requireAdmin, async (req, res) => {
  const { key, uploadId } = req.body;
  try {
    await s3Client.send(
      new AbortMultipartUploadCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: key,
        UploadId: uploadId,
      })
    );
    return res.json({ ok: true });
  } catch (err) {
    if (err.name === "NoSuchUpload" || err.Code === "NoSuchUpload") {
      console.warn("Upload already gone");
      return res.json({ ok: true });
    } else {
      throw err;
    }
  }
});


app.post("/admin/presign", requireAdmin, async (req, res) => {
  const { bucket, key, contentType } = req.body;
  try {
    const url = await getUploadUrl(bucket, key, contentType);
    res.json({ url });
  } catch (err) {
    console.error(err);
    res.status(500).send("Could not presign");
  }
});

app.post(
  "/admin/upload-course-thumbnail",
  requireAdmin,
  uploadMemory.single("thumbnail"),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).send("No file uploaded");
      if (!r2Public)
        return res.status(500).send("R2 public client not configured");

      const originalName = req.file.originalname || "course_thumb";
      const safeName = originalName.replace(/[^a-zA-Z0-9-_.]/g, "_");
      const key = `courses/thumbnails/${Date.now()}_${safeName}`;
      const buffer = req.file.buffer;
      const contentType = req.file.mimetype || "image/png";

      try {
        await uploadBufferToR2Public(key, buffer, contentType);
      } catch (err) {
        console.error("R2 public upload error:", err);
        return res.status(500).send("Upload to public bucket failed");
      }

      res.json({ key, publicUrl: getPublicUrl(key) });
    } catch (err) {
      console.error("Upload course thumbnail error:", err);
      res.status(500).send("Upload failed");
    }
  }
);

app.delete("/admin/episodes/:id", requireAdmin, async (req, res) => {
  try {
    const episodeId = req.params.id;

    // Find the course that contains this episode
    const course = await Course.findOne({ "episodes._id": episodeId });
    if (!course) return res.status(404).json({ message: "Episode not found" });

    const episode = course.episodes.id(episodeId);
    if (!episode) return res.status(404).json({ message: "Episode not found" });

    if (episode.videoKey) {
      try {
        await s3Client.send(
          new DeleteObjectCommand({
            Bucket: process.env.R2_BUCKET_NAME,
            Key: episode.videoKey,
          })
        );
      } catch (err) {
        console.warn("Could not delete from R2", err.message);
      }
    }

    course.episodes.pull({ _id: episodeId });

    await course.save();

    res.json({ success: true });
  } catch (err) {
    console.error("Delete episode error:", err);
    res.status(500).json({ message: "Error deleting episode" });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running at http://localhost:${PORT}`);
});


