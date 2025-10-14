import "dotenv/config";
import express from "express";
import authRoutes from "./routes/authRoutes";
import prospectsRoutes from "./routes/prospectsRoutes";
import clientsRoutes from "./routes/clientsRoutes";
import carriersRoutes from "./routes/carriersRoutes";
import operationsRoutes from "./routes/operationsRoutes";
import usersRoutes from "./routes/usersRoutes";
import auditRoutes from "./routes/auditRoutes";
import carrierActsRoutes from "./routes/carrierActsRoutes";
import administrationRoutes from "./routes/administrationRoutes";
import renewalRoutes from "./routes/renewalRoutes";
import prosecutorDocsRoutes from "./routes/prosecutorDocsRoutes";
import cors from "cors";
import path from "path";
import { requestLoggingMiddleware } from "./middlewares/loggingMiddleware";
import { errorMiddleware } from "./middlewares/errorMiddleware";
import { validateRequest, requestTimeout } from "./middlewares/enhancedMiddlewares";

const app = express();

// Security and performance middlewares
app.use(requestTimeout(30000)); // 30 second timeout
app.use(validateRequest);

// Request logging middleware (before parsing body)
app.use(requestLoggingMiddleware);

// Enhanced body parsing with size limits
app.use(express.json({ 
  limit: '50mb',
  verify: (req: any, res, buf, encoding) => {
    try {
      JSON.parse(buf.toString());
    } catch (e) {
      throw new Error('Invalid JSON format');
    }
  }
}));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

const isProduction = process.env.NODE_ENV === "production";

if (isProduction) {
  const corsOptions = {
    origin: "https://cciodtechnologies.com/",
    optionsSuccessStatus: 200, // some legacy browsers (IE11, various SmartTVs) choke on 204
    credentials: true,
  };

  app.use(cors(corsOptions));
} else {
  app.use(cors({
    origin: true,
    credentials: true
  }));
}

// Static files
const uploadsPath = path.resolve(__dirname, "../uploads");
app.use("/uploads", express.static(uploadsPath));

// Health check endpoint with detailed information
app.get("/health", (req, res) => {
  const healthInfo = {
    status: "OK",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || "development",
    memory: process.memoryUsage(),
    pid: process.pid,
    version: process.version,
    platform: process.platform
  };

  res.status(200).json(healthInfo);
});

// API Info endpoint
app.get("/api/info", (req, res) => {
  res.json({
    name: "CC-IOD Technologies API",
    version: "1.0.0",
    description: "API for CC-IOD Technologies management system",
    endpoints: [
      "/auth",
      "/prospects", 
      "/clients",
      "/carriers",
      "/operations",
      "/users",
      "/audit",
      "/carrier-acts",
      "/administration",
      "/renewals",
      "/prosecutor-docs"
    ]
  });
});

// -------- Routes ------------
app.use("/auth", authRoutes);
app.use("/prospects", prospectsRoutes);
app.use("/clients", clientsRoutes);
app.use("/carriers", carriersRoutes);
app.use("/operations", operationsRoutes);
app.use("/users", usersRoutes);
app.use("/audit", auditRoutes);
app.use("/carrier-acts", carrierActsRoutes);
app.use("/administration", administrationRoutes);
app.use("/renewals", renewalRoutes);
app.use("/prosecutor-docs", prosecutorDocsRoutes);

// 404 handler
app.use("*", (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.originalUrl} not found`,
    timestamp: new Date().toISOString(),
    availableRoutes: [
      "GET /health",
      "GET /api/info",
      "POST /auth/login",
      "POST /auth/register",
      // Add more routes as needed
    ]
  });
});

// Error handling middleware (must be last)
app.use(errorMiddleware);

export default app;
