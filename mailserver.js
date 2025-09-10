const express = require("express");
const multer = require("multer");
const nodemailer = require("nodemailer");
const cors = require("cors");
const readXlsxFile = require("read-excel-file/node");
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

const upload = multer({ dest: "uploads/" });
const uploadPath = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadPath)) {
  fs.mkdirSync(uploadPath);
}

(async () => {
  try {
    await client`
      CREATE TABLE IF NOT EXISTS sent_emails ( id SERIAL PRIMARY KEY, name TEXT, email TEXT, subject TEXT, message TEXT, filename TEXT, sent_at TIMESTAMP DEFAULT NOW())`;
    console.log("sent_emails table ready");
  } 
  catch (err) {
    console.error("Error creating table:", err);
  }
})();

app.post("/api/send-email", upload.single("attachment"), async (req, res) => {
  try {
    const { name, email, subject, message } = req.body;
    const file = req.file;

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS, },});
    const attachments = file ? [{ filename: file.originalname, path: file.path, },] : [];
    await transporter.sendMail({ from: process.env.SMTP_USER, to: email, subject, text: message, attachments,});


    await client`INSERT INTO sent_emails (name, email, subject, message, filename) VALUES (${name}, ${email}, ${subject}, ${message}, ${file ? file.originalname : null})`;
    res.status(200).json({ message: "Email sent successfully!" });
  } catch (err) {
    console.error("❌ Error sending email:", err);
    res.status(500).json({ message: "Failed to send email" });
  }
});

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

app.post("/api/import-emails", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });

    const { subject: commonSubject, message: commonMessage } = req.body;
    if (!commonSubject || !commonMessage) {
      return res.status(400).json({ message: "Subject and message are required" });
    }

    const rows = await readXlsxFile(req.file.path);

    // Skip header row if it has "email"
    const dataRows = rows[0][0].toString().toLowerCase().includes("email")
      ? rows.slice(1)
      : rows;

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });

    for (const row of dataRows) {
      let name = null;
      let email = null;
      let subject = commonSubject;
      let message = commonMessage;

      if (row.length === 1) {
        // [email]
        email = row[0];
      } else if (row.length === 2) {
        // [name, email]
        name = row[0];
        email = row[1];
      } else if (row.length >= 4) {
        // [name, email, subject, message]
        name = row[0];
        email = row[1];
        subject = row[2] || commonSubject;
        message = row[3] || commonMessage;
      }

      if (!email) continue;

      try {
        await transporter.sendMail({
          from: process.env.SMTP_USER,
          to: email,
          subject,
          text: message,
        });

        await client`
          INSERT INTO sent_emails (name, email, subject, message, filename) 
          VALUES (${name}, ${email}, ${subject}, ${message}, ${req.file.originalname})
        `;
      } catch (err) {
        console.error(`❌ Failed to send ${email}:`, err.message);
      }
    }

    res.json({ message: "✅ Bulk emails sent successfully!" });
  } catch (err) {
    console.error("❌ Bulk import error:", err);
    res.status(500).json({ message: "Failed to send bulk emails" });
  }
});


app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
