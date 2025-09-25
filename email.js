function baseTemplate(title, message) {
  return `
  <div style="background:#f9f9f9;padding:30px 0;font-family:Arial,sans-serif;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" width="600" style="background:#ffffff;border-radius:8px;overflow:hidden;">
            <tr>
              <td style="background:#cfA525;color:#000000;text-align:center;padding:30px;">
                <h1 style="margin:0;font-size:32px;font-weight:bold;color:#000000">King Fidel</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:30px;text-align:left;color:#cfA525;">
                ${
                  title
                    ? `<h2 style="color:#cfA525;margin-top:0;">${title}</h2>`
                    : ""
                }
                <div style="font-size:16px;line-height:1.6;color:#555555;">
                  ${message}
                </div>
                <p style="font-size:14px;color:#999999;margin-top:30px;">If you have any questions, just reply to this email.</p>
              </td>
            </tr>
            <tr>
              <td style="background:#f0f0f0;text-align:center;padding:15px;color:#888888;font-size:12px;">
                © ${new Date().getFullYear()} King Fidel. All rights reserved.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </div>
  `;
}

function subscriptionCreated(name) {
  const title = `Your Subscription is Active`;
  const message = `
    <p>Hi ${name},</p>
    <p>Thank you for subscribing to our courses. Your subscription is now active.</p>
    <p>We’re excited to have you onboard!</p>
  `;
  return {
    subject: "Your Subscription is Active",
    html: baseTemplate(title, message),
  };
}

function adminTransactionNotification(transaction) {
  const title = `New Transaction Received`;
  const message = `
    <p>Hi Team,</p>
    <p>A new transaction has just been completed on King Fidel.</p>
    <ul style="list-style:none;padding:0;">
      <li><strong>Customer:</strong> ${transaction.customerName || "N/A"}</li>
      <li><strong>Email:</strong> ${transaction.customerEmail || "N/A"}</li>
      <li><strong>Amount:</strong> ${transaction.amount} ${transaction.currency}</li>
      <li><strong>Reference:</strong> ${transaction.tx_ref}</li>
      <li><strong>Type:</strong> ${transaction.type || "N/A"}</li>
      <li><strong>Date:</strong> ${new Date(transaction.date).toLocaleString()}</li>
    </ul>
    <p>You can view more details in your admin dashboard.</p>
  `;
  return {
    subject: `New Transaction – ${transaction.amount} ${transaction.currency}`,
    html: baseTemplate(title, message),
  };
}


function otpLogin(fullName, otp) {
  return `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <style>
      body {
        font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
        background: #f7f9fb;
        color: #333;
        margin: 0;
        padding: 0;
      }
      .container {
        max-width: 600px;
        margin: 40px auto;
        background: #ffffff;
        border-radius: 8px;
        overflow: hidden;
        box-shadow: 0 4px 16px rgba(0,0,0,0.06);
      }
      .header {
        background: #cfA525;
        color: white;
        padding: 24px;
        text-align: center;
        font-size: 20px;
        font-weight: 700;
      }
      .content {
        padding: 24px;
        line-height: 1.6;
        font-size: 16px;
      }
      .otp-box {
        display: inline-block;
        background: #f0f4f8;
        color: #cfA525;
        font-weight: bold;
        font-size: 28px;
        letter-spacing: 4px;
        padding: 12px 20px;
        border-radius: 6px;
        margin: 16px 0;
      }
      .footer {
        text-align: center;
        font-size: 12px;
        color: #777;
        padding: 16px 24px;
        border-top: 1px solid #eee;
      }
      @media (max-width:600px){
        .container{margin:0;}
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        King Fidel – Login Verification
      </div>
      <div class="content">
        <p>Hi ${fullName},</p>
        <p>We received a login request for your account. Please use the following one-time code to complete your sign-in:</p>
        <div class="otp-box">${otp}</div>
        <p>This code expires in 5 minutes. If you did not attempt to sign in, you can safely ignore this email.</p>
        <p>Thank you,<br/>The King Fidel Team</p>
      </div>
      <div class="footer">
        &copy; ${new Date().getFullYear()} King Fidel. All rights reserved.
      </div>
    </div>
  </body>
</html>
`;
}

module.exports = {
  subscriptionCreated,
  adminTransactionNotification,
  otpLogin
};
