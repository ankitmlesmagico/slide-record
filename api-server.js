const express = require("express");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const { recordSlidesOnMacOS } = require("./record-slides-macos-api");
const { initializeBucket, listRecordings, deleteFromMinIO } = require("./minio-config");

const app = express();
const PORT = process.env.PORT || 3002;

// Middleware
app.use(express.json());
app.use("/recordings", express.static("recordings"));

// Ensure recordings directory exists
if (!fs.existsSync("recordings")) {
  fs.mkdirSync("recordings", { recursive: true });
}

/**
 * POST /api/record
 * Records a Google Slides presentation
 *
 * Body:
 * {
 *   "slideUrl": "https://docs.google.com/presentation/d/...",
 *   "timings": [5, 10, 15, 20]  // seconds when to advance slides
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "recordingPath": "/recordings/slideshow_2024-01-01_12345678.mp4"
 * }
 */
app.post("/api/record", async (req, res) => {
  try {
    const { slideUrl, timings } = req.body;

    // Validate input
    if (!slideUrl || typeof slideUrl !== "string") {
      return res.status(400).json({
        error: "slideUrl is required and must be a string",
      });
    }

    if (!timings || !Array.isArray(timings) || timings.length === 0) {
      return res.status(400).json({
        error: "timings is required and must be a non-empty array of numbers",
      });
    }

    // Validate timings are numbers and in ascending order
    for (let i = 0; i < timings.length; i++) {
      if (typeof timings[i] !== "number" || timings[i] <= 0) {
        return res.status(400).json({
          error: `Invalid timing at index ${i}. All timings must be positive numbers`,
        });
      }
      if (i > 0 && timings[i] <= timings[i - 1]) {
        return res.status(400).json({
          error: `Timings must be in ascending order. Issue at index ${i}`,
        });
      }
    }

    // Validate URL format
    if (!slideUrl.includes("docs.google.com/presentation")) {
      return res.status(400).json({
        error: "Invalid Google Slides URL format",
      });
    }

    const recordingId = uuidv4();
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const outputFileName = `slideshow_${timestamp}_${recordingId.substring(
      0,
      8
    )}.mp4`;
    const outputPath = path.join("recordings", outputFileName);

    // Start recording synchronously and wait for completion
    const result = await recordSlidesOnMacOS(slideUrl, timings, outputPath);

    if (result.success) {
      res.json({
        success: true,
        videoUrl: result.videoUrl,
        fileName: result.fileName,
        message: "Recording completed and uploaded to MinIO successfully",
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error || "Recording failed",
      });
    }
  } catch (error) {
    console.error("Error starting recording:", error);
    res.status(500).json({
      error: "Internal server error",
      message: error.message,
    });
  }
});



// Error handling middleware
app.use((error, req, res, next) => {
  console.error("Unhandled error:", error);
  res.status(500).json({
    error: "Internal server error",
    message: error.message,
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: "Endpoint not found",
    availableEndpoints: [
      "POST /api/record",
      "GET /api/recordings", 
      "DELETE /api/recording/:filename"
    ],
  });
});

/**
 * GET /api/recordings
 * List all recordings from MinIO
 */
app.get("/api/recordings", async (req, res) => {
  try {
    const recordings = await listRecordings();
    res.json({
      success: true,
      recordings: recordings.map(recording => ({
        name: recording.name,
        url: recording.url,
        size: recording.size,
        sizeMB: Math.round(recording.size / (1024 * 1024) * 100) / 100,
        lastModified: recording.lastModified
      }))
    });
  } catch (error) {
    console.error('Error listing recordings:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to list recordings from MinIO'
    });
  }
});

/**
 * DELETE /api/recording/:filename
 * Delete a recording from MinIO
 */
app.delete("/api/recording/:filename", async (req, res) => {
  try {
    const { filename } = req.params;
    
    // Security check
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }
    
    const objectName = `recordings/${filename}`;
    await deleteFromMinIO(objectName);
    
    res.json({
      success: true,
      message: 'Recording deleted successfully from MinIO'
    });
  } catch (error) {
    console.error('Error deleting recording:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete recording from MinIO'
    });
  }
});

// Initialize MinIO and start server
async function startServer() {
  try {
    console.log('🔧 Initializing MinIO...');
    await initializeBucket();
    
    app.listen(PORT, () => {
      console.log(`🎬 Slides Recording API Server running on port ${PORT}`);
      console.log(`📝 Main endpoint: POST /api/record`);
      console.log(`📁 List recordings: GET /api/recordings`);
      console.log(`🗑️ Delete recording: DELETE /api/recording/:filename`);
      console.log(`🌐 MinIO Console: http://localhost:9001`);
    });
  } catch (error) {
    console.error('❌ Failed to initialize server:', error);
    process.exit(1);
  }
}

startServer();

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\n🛑 Shutting down gracefully...");
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\n🛑 Shutting down gracefully...");
  process.exit(0);
});
