
import app from "./app";
import { logInfo, logError } from "./middlewares/loggingMiddleware";

const PORT = process.env.PORT || 5000;

// Enhanced server startup with better logging
const startServer = () => {
  try {
    const server = app.listen(PORT, () => {
      logInfo(`🚀 Server started successfully`);
      logInfo(`📡 Server is running on PORT: ${PORT}`);
      logInfo(`🌍 Environment: ${process.env.NODE_ENV || "development"}`);
      logInfo(`📂 Working directory: ${process.cwd()}`);
      logInfo(`⏰ Started at: ${new Date().toISOString()}`);
      
      if (process.env.NODE_ENV !== "production") {
        logInfo(`🔧 Development mode - Enhanced logging enabled`);
        logInfo(`🏥 Health check available at: http://localhost:${PORT}/health`);
      }
    });

    // Handle server errors
    server.on('error', (error: any) => {
      if (error.code === 'EADDRINUSE') {
        logError(`❌ Port ${PORT} is already in use`);
      } else {
        logError('❌ Server error:', error);
      }
      process.exit(1);
    });

    // Graceful shutdown
    const gracefulShutdown = (signal: string) => {
      logInfo(`📡 Received ${signal}. Starting graceful shutdown...`);
      
      server.close(() => {
        logInfo('✅ Server closed successfully');
        process.exit(0);
      });

      // Force close after 10 seconds
      setTimeout(() => {
        logError('❌ Forced shutdown after timeout');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      logError(error, 'Uncaught Exception');
      process.exit(1);
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      console.error('💥 Unhandled Rejection at:', promise);
      logError(reason as any, 'Unhandled Rejection');
      process.exit(1);
    });

  } catch (error) {
    logError(error as any, 'Server Startup Error');
    process.exit(1);
  }
};

startServer();