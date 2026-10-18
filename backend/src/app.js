import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import authRoutes from "./routes/authRoutes.js";
import conversationRoutes from "./routes/conversatonRoutes.js";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    status: "ok",
    message: "LearnLoom backend is running",
  });
});

app.get("/api/health/ready", (req, res) => {
  const mongoStates = ["disconnected", "connected", "connecting", "disconnecting"];
  const mongoStatus = mongoStates[mongoose.connection.readyState] ?? "unknown";
  const ready = mongoStatus === "connected";

  res.status(ready ? 200 : 503).json({
    success: ready,
    status: ready ? "ready" : "not_ready",
    checks: { mongodb: mongoStatus },
  });
});

app.use("/api/auth", authRoutes);

app.use("/api/conversations", conversationRoutes);

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 500
    ? error.status
    : 500;
  if (status === 500) console.error("Unhandled API error:", error.message);
  return res.status(status).json({
    success: false,
    message: status === 400 ? "Invalid request body" : "The request could not be completed",
  });
});

export default app;

