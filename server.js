// send_bulk_ses.js
// Usage: node send_bulk_ses.js
// WARNING: Use only with verified sending domain and SES quota.

const nodemailer = require('nodemailer');
const fs = require('fs');

// CONFIG - set these via ENV or config file in production
const SMTP_HOST = process.env.SMTP_HOST || 'email-smtp.us-east-1.amazonaws.com'; // SES SMTP endpoint
const SMTP_PORT = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 465;
const SMTP_USER = process.env.SMTP_USER || 'YOUR_SES_SMTP_USER';
const SMTP_PASS = process.env.SMTP_PASS || 'YOUR_SES_SMTP_PASS';
const FROM = process.env.FROM || 'you@yourdomain.com';
const FROM_NAME = process.env.FROM_NAME || 'Your Name';

// Batch settings
const BATCH_SIZE = 25;             // 25 emails per batch (parallel)
const BATCH_INTERVAL_MS = 216000;  // ~216 seconds (3.6 min) between batches to reach 10k/day with 25 batch size
const RETRIES = 3;
const RECIPIENTS_FILE = './recipients.txt'; // newline-separated list

// Load recipients
const recipients = fs.readFileSync(RECIPIENTS_FILE, 'utf8').split(/\r?\n/).map(line=>line.trim()).filter(Boolean);

// Setup transporter (SES SMTP)
const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: SMTP_PORT === 465,
  auth: { user: SMTP_USER, pass: SMTP_PASS },
  pool: true, // enable pooling to reuse connections
  maxMessages: Infinity
});

// Helper send with retry
async function sendOne(to, subject, text) {
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      await transporter.sendMail({
        from: `"${FROM_NAME}" <${FROM}>`,
        to,
        subject,
        text
      });
      return { to, ok: true };
    } catch (err) {
      console.error(`Error sending to ${to} attempt ${attempt}:`, err && err.message);
      // transient? wait and retry
      if (attempt < RETRIES) {
        const wait = Math.pow(2, attempt) * 1000 + Math.floor(Math.random()*1000);
        await new Promise(r => setTimeout(r, wait));
      } else {
        return { to, ok: false, error: err && err.message };
      }
    }
  }
}

// Send batches
async function runBatches() {
  console.log(`Total recipients: ${recipients.length}`);
  let idx = 0;
  while (idx < recipients.length) {
    const batch = recipients.slice(idx, idx + BATCH_SIZE);
    console.log(`Sending batch ${Math.floor(idx/BATCH_SIZE)+1} - ${batch.length} recipients`);
    // map to promises (parallel inside batch)
    const promises = batch.map(r => sendOne(r, 'Quick question', 'Hi,\n\nI had a small suggestion for your website — may I share it?\n\nThanks,\nYour Name'));
    const results = await Promise.all(promises);
    const success = results.filter(r => r.ok).length;
    const fail = results.filter(r => !r.ok).length;
    console.log(`Batch result: success=${success}, fail=${fail}`);
    idx += BATCH_SIZE;
    if (idx < recipients.length) {
      console.log(`Waiting ${BATCH_INTERVAL_MS/1000}s before next batch...`);
      await new Promise(r => setTimeout(r, BATCH_INTERVAL_MS));
    }
  }
  console.log('All batches finished');
  transporter.close();
}

runBatches().catch(e => { console.error('Fatal error', e); transporter.close(); });
