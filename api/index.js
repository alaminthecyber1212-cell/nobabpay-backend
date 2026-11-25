
const express = require("express");
const admin = require("firebase-admin");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

if (!admin.apps.length) {
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    : null;

  if (serviceAccount && process.env.FIREBASE_DATABASE_URL) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: process.env.FIREBASE_DATABASE_URL,
    });
  }
}

app.get(["/", "/api"], (req, res) => {
  res.status(200).json({ ok: true, service: "nobabpay-backend" });
});

app.post(["/create-payment", "/api/create-payment"], async (req, res) => {
  try {
    const { uid, amount, full_name, email, redirect_url, cancel_url } = req.body || {};
    const brandKey = process.env.NOBABPAY_BRAND_KEY;

    if (!brandKey) {
      return res.status(500).json({ error: "NOBABPAY_BRAND_KEY missing" });
    }
    if (!uid || !amount || Number(amount) <= 0) {
      return res.status(400).json({ error: "uid and positive amount are required" });
    }

    const baseUrl = process.env.NOBABPAY_BASE_URL || "https://nobabpay.com";
    const webhookUrl = `${req.protocol}://${req.get("host")}/api/webhook`;

    const params = new URLSearchParams({
      brand_key: brandKey,
      amount: String(amount),
      full_name: full_name || "Customer",
      email: email || `${uid}@panel.local`,
      redirect_url: redirect_url || "https://alaminthecyber1212-cell.github.io/Panel-seller-/",
      cancel_url: cancel_url || "https://alaminthecyber1212-cell.github.io/Panel-seller-/",
      webhook_url: webhookUrl,
      metadata: JSON.stringify({ uid }),
    });

    const response = await fetch(`${baseUrl}/api/v1/create-payment.php`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    const data = await response.json();
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.all(["/webhook", "/api/webhook"], async (req, res) => {
  try {
    const payload = { ...(req.query || {}), ...(req.body || {}) };
    const invoiceId = payload.invoice_id || payload.transaction_id || payload.trx_id;

    if (!invoiceId) {
      return res.status(400).json({ error: "invoice_id missing" });
    }

    if (!admin.apps.length) {
      return res.status(500).json({ error: "Firebase not initialized" });
    }

    const db = admin.database();
    const processedRef = db.ref(`processedPayments/${invoiceId}`);
    const snap = await processedRef.get();

    if (snap.exists()) {
      return res.status(200).json({ ok: true, duplicate: true });
    }

    const amount = Number(payload.amount || 0);
    let uid = payload.uid;

    if (!uid && payload.metadata) {
      try {
        const meta = typeof payload.metadata === "string" ? JSON.parse(payload.metadata) : payload.metadata;
        uid = meta.uid;
      } catch (_) {}
    }

    if (!uid || amount <= 0) {
      return res.status(400).json({ error: "Invalid uid or amount" });
    }

    const balanceRef = db.ref(`users/${uid}/balance`);
    await balanceRef.transaction((current) => (Number(current) || 0) + amount);
    await processedRef.set({
      uid,
      amount,
      invoiceId,
      createdAt: Date.now(),
    });

    return res.status(200).json({ ok: true, credited: amount });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = app;
