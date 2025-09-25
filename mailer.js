const nodemailer = require("nodemailer");
require("dotenv").config();
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.USER_EMAIL, // your email account
    pass: process.env.USER_PASS,
  },
});

async function sendMail({ to, subject, html }) {
  await transporter.sendMail({
    from: `"King Fidel Support" <support@kingfidel.com>`, 
    to,
    subject,
    html,
  });
}

module.exports = { sendMail };
