const express = require("express");
const multer = require("multer");
const nodemailer = require("nodemailer");
const cors = require("cors");
const dotenv = require("dotenv");
const { neon } = require("@neondatabase/serverless");
const fs = require("fs");
const path = require("path");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
const client = neon(process.env.DATABASE_URL);
app.use(express.json());
app.use(cors());

// Multer setup
const upload = multer({ dest: "uploads/" });
const uploadPath = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadPath)) {
  fs.mkdirSync(uploadPath);
}

// ✅ Create table if not exists
(async () => {
  try {
    await client`
      CREATE TABLE IF NOT EXISTS sent_emails ( id SERIAL PRIMARY KEY, name TEXT, email TEXT, subject TEXT, message TEXT, filename TEXT, sent_at TIMESTAMP DEFAULT NOW())`;
    console.log("✅ sent_emails table ready");
  } catch (err) {
    console.error("❌ Error creating table:", err);
  }
})();

// ✅ Send email API
app.post("/api/send-email", upload.single("attachment"), async (req, res) => {
  try {
    const { name, email, subject, message } = req.body;
    const file = req.file;

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS, },});

    // Build attachments array
    const attachments = file ? [{ filename: file.originalname, path: file.path, },] : [];

    // Send email
    await transporter.sendMail({ from: process.env.SMTP_USER, to: email, subject, text: message, attachments,});

    // Save to DB
    await client`INSERT INTO sent_emails (name, email, subject, message, filename) VALUES (${name}, ${email}, ${subject}, ${message}, ${file ? file.originalname : null})`;

    res.status(200).json({ message: "Email sent successfully!" });
  } catch (err) {
    console.error("❌ Error sending email:", err);
    res.status(500).json({ message: "Failed to send email" });
  }
});

// ✅ Get sent emails API
app.get("/api/sent-emails", async (req, res) => {
  try {
    const emails = await client`SELECT * FROM sent_emails ORDER BY sent_at DESC`;
    res.json(emails);
  } 
  catch (err) {
    console.error("❌ Error fetching emails:", err);
    res.status(500).json({ message: "Failed to fetch emails" });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
