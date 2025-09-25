const nodemailer = require("nodemailer");
require("dotenv").config();

const transporter = nodemailer.createTransport({
  service: 'gmail', // change to your SMTP if needed
  auth: {
    user: process.env.USER_EMAIL,
    pass: process.env.USER_PASS
  }
});

async function sendEmailOtp(toEmail, otp, purpose = "password reset") {
  const htmlBody = `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      body {
        background: #f6f8fb;
        font-family: "Segoe UI", Arial, sans-serif;
        padding: 0;
        margin: 0;
      }
      .container {
        background: #ffffff;
        max-width: 500px;
        margin: 40px auto;
        padding: 30px;
        border-radius: 12px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.08);
        text-align: center;
      }
      .header {
        font-size: 26px;
        font-weight: 700;
        color: #cfA525;
        margin-bottom: 10px;
      }
      .purpose {
        font-size: 16px;
        color: #555;
        margin-bottom: 20px;
      }
      .otp {
        font-size: 32px;
        letter-spacing: 6px;
        font-weight: bold;
        color: #cfA525;
        padding: 15px 25px;
        border: 2px dashed #cfA525;
        display: inline-block;
        border-radius: 8px;
        margin-bottom: 20px;
      }
      .footer {
        font-size: 13px;
        color: #999;
        margin-top: 30px;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">King Fidel</div>
      <div class="purpose">Your OTP for ${purpose}:</div>
      <div class="otp">${otp}</div>
      <p>This code will expire in 10 minutes. Do not share it with anyone.</p>
      <div class="footer">
        &copy; ${new Date().getFullYear()} King Fidel. All rights reserved.
      </div>
    </div>
  </body>
  </html>`;

  const mailOptions = {
    from: `"King Fidel Support" <no-reply@kingfidel.com>`,
    to: toEmail,
    subject: `OTP for ${purpose}`,
    text: `Your Verification Code is: ${otp} (valid for 10 minutes)`,
    html: htmlBody
  };

  await transporter.sendMail(mailOptions);
}

module.exports = sendEmailOtp;
