require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/ticketsafe";

app.use(cors());
app.use(express.json({ limit: "1mb" }));

const passengerSchema = new mongoose.Schema({
  seat: { type: String, required: true },
  name: { type: String, required: true, trim: true },
  phone: { type: String, required: true, match: /^[0-9]{10}$/ },
  gender: { type: String, required: true }
}, { _id: false });

const bookingSchema = new mongoose.Schema({
  bookingId: { type: String, required: true, unique: true, index: true },
  service: { type: String, required: true },
  category: { type: String, required: true, lowercase: true },
  route: { type: String, default: "" },
  seats: { type: [String], required: true },
  time: { type: String, default: "" },
  date: { type: String, default: null },
  passengers: { type: [passengerSchema], required: true },
  total: { type: Number, required: true, min: 0 },
  createdAt: { type: Date, default: Date.now },
  bookingStatus: { type: String, default: "CONFIRMED" }
}, { timestamps: true });

const seatReservationSchema = new mongoose.Schema({
  serviceKey: { type: String, required: true },
  seat: { type: String, required: true },
  bookingId: { type: String, required: true },
  reservedAt: { type: Date, default: Date.now }
});
seatReservationSchema.index({ serviceKey: 1, seat: 1 }, { unique: true });

const Booking = mongoose.model("Booking", bookingSchema);
const SeatReservation = mongoose.model("SeatReservation", seatReservationSchema);

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    database: mongoose.connection.readyState === 1 ? "connected" : "disconnected"
  });
});

app.get("/api/bookings", async (req, res) => {
  try {
    const filter = {};
    if (req.query.status) filter.bookingStatus = req.query.status;
    const bookings = await Booking.find(filter).sort({ createdAt: -1 }).lean();
    res.json({ bookings });
  } catch (err) {
    res.status(500).json({ message: "Could not load bookings.", error: err.message });
  }
});

app.post("/api/bookings", async (req, res) => {
  const input = req.body || {};
  const seats = Array.isArray(input.seats) ? [...new Set(input.seats.map(String))] : [];
  if (!input.bookingId || !input.service || !input.category || !seats.length ||
      !Array.isArray(input.passengers) || input.passengers.length !== seats.length) {
    return res.status(400).json({ message: "Booking details are incomplete. Check service, seats and passenger details." });
  }
  if (seats.length > 6) return res.status(400).json({ message: "Maximum 6 seats can be booked." });

  const serviceKey = [
    String(input.category).toLowerCase(),
    String(input.service).trim().toLowerCase(),
    String(input.date || "no-date"),
    String(input.time || "")
  ].join("|");

  const insertedReservations = [];
  try {
    // Unique MongoDB index makes seat claims conflict-safe across concurrent API requests.
    for (const seat of seats) {
      const reservation = await SeatReservation.create({
        serviceKey, seat, bookingId: String(input.bookingId)
      });
      insertedReservations.push(reservation._id);
    }

    const booking = await Booking.create({
      bookingId: String(input.bookingId),
      service: String(input.service),
      category: String(input.category).toLowerCase(),
      route: String(input.route || ""),
      seats,
      time: String(input.time || ""),
      date: input.date || null,
      passengers: input.passengers,
      total: Number(input.total || 0),
      createdAt: input.createdAt ? new Date(input.createdAt) : new Date(),
      bookingStatus: "CONFIRMED"
    });
    return res.status(201).json({ message: "Booking saved to MongoDB.", booking });
  } catch (err) {
    if (insertedReservations.length) {
      await SeatReservation.deleteMany({ _id: { $in: insertedReservations } }).catch(() => {});
    }
    if (err && err.code === 11000) {
      return res.status(409).json({ message: "One or more selected seats have already been booked. Please choose different seats." });
    }
    if (err && err.name === "ValidationError") {
      return res.status(400).json({ message: "Invalid booking data.", error: err.message });
    }
    return res.status(500).json({ message: "Booking could not be saved.", error: err.message });
  }
});

app.get("/api/bookings/:bookingId", async (req, res) => {
  try {
    const booking = await Booking.findOne({ bookingId: req.params.bookingId }).lean();
    if (!booking) return res.status(404).json({ message: "Booking not found." });
    res.json({ booking });
  } catch (err) {
    res.status(500).json({ message: "Could not load booking.", error: err.message });
  }
});

mongoose.connect(MONGODB_URI)
  .then(() => {
    console.log("Connected to MongoDB");
    app.listen(PORT, () => console.log(`TicketSafe API running at http://localhost:${PORT}`));
  })
  .catch(err => {
    console.error("MongoDB connection failed:", err.message);
    process.exit(1);
  });
