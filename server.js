const express = require("express");
const puppeteer = require("puppeteer");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const os = require("os");

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static("public"));
app.use("/recordings", express.static("recordings"));

// Ensure recordings directory exists
if (!fs.existsSync("recordings")) {
  fs.mkdirSync("recordings");
}

app.post("/record", async (req, res) => {
  const { slideUrl, timings } = req.body;

  if (!slideUrl || !timings || !Array.isArray(timings)) {
    return res.status(400).json({ error: "Invalid input" });
  }

  const recordingId = uuidv4();
  const outputPath = `recordings/${recordingId}.mp4`;

  try {
    await recordSlideshow(slideUrl, timings, outputPath);
    res.json({
      success: true,
      downloadUrl: `/recordings/${recordingId}.mp4`,
      recordingId,
    });
  } catch (error) {
    console.error("Recording failed:", error);
    res.status(500).json({ error: "Recording failed: " + error.message });
  }
});

async function recordSlideshow(slideUrl, timings, outputPath) {
  let browser;
  let ffmpegProcess;

  try {
    // Launch browser with platform-specific configuration
    const browserConfig = {
      headless: false,
      args: [
        "--start-fullscreen",
        "--disable-web-security",
        "--disable-features=VizDisplayCompositor",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-infobars",
        "--disable-extensions",
        "--disable-plugins",
        "--disable-popup-blocking",
        "--kiosk", // Force true fullscreen mode
      ],
    };

    // Set platform-specific Chrome path
    if (os.platform() === "darwin") {
      browserConfig.executablePath =
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    } else if (os.platform() === "linux") {
      browserConfig.executablePath = "/usr/bin/google-chrome";
    }

    console.log("Launching browser with platform:", os.platform());
    browser = await puppeteer.launch(browserConfig);

    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 810 });

    // Convert regular slides URL to presentation mode
    const presentUrl = slideUrl.includes("/present")
      ? slideUrl
      : slideUrl.replace("/edit", "/present").replace("#", "/present#");

    console.log("Opening presentation:", presentUrl);
    await page.goto(presentUrl, { waitUntil: "networkidle2" });

    // Wait for presentation to load
    await page.waitForTimeout(3000);

    // On macOS, maximize the Chrome window using AppleScript
    if (os.platform() === "darwin") {
      await maximizeChromeWindow();
      await page.waitForTimeout(1000);
    }

    // Ensure we're in presentation mode by pressing F5 (start slideshow)
    await page.keyboard.press("F5");
    await page.waitForTimeout(2000);

    // Hide cursor by moving it to corner
    await page.mouse.move(0, 0);

    // Get window info for recording
    const windowInfo = await getWindowInfo(browser);

    // Start recording
    ffmpegProcess = await startRecording(windowInfo, outputPath);

    // Wait a moment for recording to start
    await page.waitForTimeout(2000);

    // Execute slide transitions based on timings
    let currentTime = 0;
    for (let i = 0; i < timings.length; i++) {
      const waitTime = (timings[i] - currentTime) * 1000;
      if (waitTime > 0) {
        await page.waitForTimeout(waitTime);
      }

      // Press right arrow to advance slide
      await page.keyboard.press("ArrowRight");
      console.log(`Advanced to slide ${i + 2} at ${timings[i]}s`);
      currentTime = timings[i];
    }

    // Wait additional 5 seconds after last slide
    await page.waitForTimeout(5000);
  } finally {
    // Cleanup
    if (browser) {
      await browser.close();
    }

    if (ffmpegProcess) {
      console.log("Stopping FFmpeg recording...");

      // Send 'q' to ffmpeg for graceful shutdown
      try {
        ffmpegProcess.stdin.write("q");
        ffmpegProcess.stdin.end();
      } catch (error) {
        console.log("Could not send 'q' to ffmpeg, using SIGTERM");
        ffmpegProcess.kill("SIGTERM");
      }

      // Wait for ffmpeg to finish processing
      await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          console.log("Force killing FFmpeg after timeout");
          ffmpegProcess.kill("SIGKILL");
          resolve();
        }, 10000); // 10 second timeout

        ffmpegProcess.on("close", (code) => {
          clearTimeout(timeout);
          console.log(`FFmpeg closed with code: ${code}`);
          resolve();
        });
      });

      // Check if file was created and has content
      try {
        const stats = fs.statSync(outputPath);
        console.log(`Recording file size: ${stats.size} bytes`);
        if (stats.size === 0) {
          throw new Error("Recording file is empty (0 bytes)");
        }
      } catch (error) {
        console.error("Recording file check failed:", error);
        throw error;
      }
    }
  }
}

async function getScreenResolution() {
  return new Promise((resolve) => {
    if (os.platform() === "darwin") {
      // macOS: Use system_profiler to get display info
      const systemProfiler = spawn("system_profiler", ["SPDisplaysDataType"]);
      let output = "";

      systemProfiler.stdout.on("data", (data) => {
        output += data.toString();
      });

      systemProfiler.on("close", () => {
        const match = output.match(/Resolution: (\d+) x (\d+)/);
        if (match) {
          resolve({ width: parseInt(match[1]), height: parseInt(match[2]) });
        } else {
          resolve({ width: 1440, height: 900 }); // Common macOS resolution
        }
      });

      systemProfiler.on("error", () => {
        resolve({ width: 1440, height: 900 });
      });
    } else {
      // Linux: Use xrandr
      const xrandr = spawn("xrandr");
      let output = "";

      xrandr.stdout.on("data", (data) => {
        output += data.toString();
      });

      xrandr.on("close", () => {
        const match = output.match(/(\d+)x(\d+).*\*/);
        if (match) {
          resolve({ width: parseInt(match[1]), height: parseInt(match[2]) });
        } else {
          resolve({ width: 1440, height: 810 });
        }
      });

      xrandr.on("error", () => {
        resolve({ width: 1440, height: 810 });
      });
    }
  });
}

async function getWindowInfo(browser) {
  const screenRes = await getScreenResolution();
  console.log("Screen resolution:", screenRes);

  if (os.platform() === "darwin") {
    // Try to get Chrome window bounds using AppleScript
    try {
      const windowInfo = await getChromeWindowBounds();
      if (windowInfo) {
        console.log("Chrome window bounds:", windowInfo);
        return windowInfo;
      }
    } catch (error) {
      console.log("Could not get Chrome window bounds:", error.message);
    }

    // Fallback to full screen
    return {
      x: 0,
      y: 0,
      width: screenRes.width,
      height: screenRes.height,
    };
  } else {
    // Linux: Use screen resolution
    return { x: 0, y: 0, width: screenRes.width, height: screenRes.height };
  }
}

async function getChromeWindowBounds() {
  return new Promise((resolve, reject) => {
    const script = `
      tell application "Google Chrome"
        if (count of windows) > 0 then
          set chromeWindow to window 1
          set windowBounds to bounds of chromeWindow
          set x to item 1 of windowBounds
          set y to item 2 of windowBounds
          set width to (item 3 of windowBounds) - x
          set height to (item 4 of windowBounds) - y
          return x & "," & y & "," & width & "," & height
        else
          return "no_window"
        end if
      end tell
    `;

    const osascript = spawn("osascript", ["-e", script]);
    let output = "";

    osascript.stdout.on("data", (data) => {
      output += data.toString().trim();
    });

    osascript.on("close", (code) => {
      if (code === 0 && output && output !== "no_window") {
        const [x, y, width, height] = output.split(",").map(Number);
        resolve({ x, y, width, height });
      } else {
        reject(new Error("Could not get window bounds"));
      }
    });

    osascript.on("error", reject);
  });
}

async function maximizeChromeWindow() {
  return new Promise((resolve, reject) => {
    const script = `
      tell application "Google Chrome"
        if (count of windows) > 0 then
          set chromeWindow to window 1
          tell chromeWindow
            set bounds to {0, 0, 1440, 900}
          end tell
          return "maximized"
        else
          return "no_window"
        end if
      end tell
    `;

    const osascript = spawn("osascript", ["-e", script]);

    osascript.on("close", (code) => {
      resolve();
    });

    osascript.on("error", (error) => {
      console.log("Could not maximize window:", error.message);
      resolve(); // Don't fail the whole process
    });
  });
}

async function startRecording(windowInfo, outputPath) {
  return new Promise((resolve, reject) => {
    let ffmpegArgs;

    if (os.platform() === "darwin") {
      // macOS: Use avfoundation to capture screen
      ffmpegArgs = [
        "-f",
        "avfoundation",
        "-framerate",
        "30",
        "-i",
        "1", // Capture screen device 1 (from list_devices output)
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast", // Faster encoding for real-time
        "-crf",
        "18", // Better quality
        "-pix_fmt",
        "yuv420p", // This will trigger automatic conversion
      ];

      // Add cropping if we have specific window bounds and they're reasonable
      if (
        windowInfo.x > 0 ||
        windowInfo.y > 0 ||
        (windowInfo.width < 1920 && windowInfo.width > 100) ||
        (windowInfo.height < 1080 && windowInfo.height > 100)
      ) {
        console.log(
          `Applying crop: ${windowInfo.width}x${windowInfo.height} at ${windowInfo.x},${windowInfo.y}`
        );
        ffmpegArgs.push(
          "-filter:v",
          `crop=${windowInfo.width}:${windowInfo.height}:${windowInfo.x}:${windowInfo.y}`
        );
      }

      ffmpegArgs.push("-y", outputPath);
    } else {
      // Linux: Use x11grab
      ffmpegArgs = [
        "-f",
        "x11grab",
        "-r",
        "30",
        "-s",
        `${windowInfo.width}x${windowInfo.height}`,
        "-i",
        `:0.0+${windowInfo.x},${windowInfo.y}`,
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "23",
        "-y",
        outputPath,
      ];
    }

    console.log("Starting ffmpeg with args:", ffmpegArgs.join(" "));
    const ffmpeg = spawn("ffmpeg", ffmpegArgs);

    let hasStarted = false;
    let errorOutput = "";

    ffmpeg.stdout.on("data", (data) => {
      console.log("FFmpeg stdout:", data.toString());
    });

    ffmpeg.stderr.on("data", (data) => {
      const output = data.toString();
      console.log("FFmpeg stderr:", output);
      errorOutput += output;

      // Check if recording has started successfully
      if (
        output.includes("frame=") ||
        output.includes("fps=") ||
        output.includes("time=")
      ) {
        if (!hasStarted) {
          hasStarted = true;
          console.log("✅ FFmpeg recording started successfully");
          resolve(ffmpeg);
        }
      }

      // Check for errors
      if (
        output.includes("Permission denied") ||
        output.includes("Operation not permitted")
      ) {
        reject(
          new Error(
            "Screen recording permission denied. Please grant screen recording permission in System Preferences > Security & Privacy > Privacy > Screen Recording"
          )
        );
      }

      if (
        output.includes("No such file or directory") ||
        output.includes("Invalid data found")
      ) {
        reject(new Error("FFmpeg input device error: " + output));
      }
    });

    ffmpeg.on("error", (error) => {
      console.error("FFmpeg spawn error:", error);
      reject(error);
    });

    ffmpeg.on("close", (code) => {
      console.log(`FFmpeg process closed with code ${code}`);
      if (code !== 0 && !hasStarted) {
        reject(
          new Error(
            `FFmpeg failed to start (exit code ${code}): ${errorOutput}`
          )
        );
      }
    });

    // Resolve after 5 seconds if no frame output detected (fallback)
    setTimeout(() => {
      if (!hasStarted) {
        console.log("⚠️  FFmpeg didn't report frames, but proceeding anyway");
        resolve(ffmpeg);
      }
    }, 5000);
  });
}

// Test endpoint to check screen recording setup
app.get("/test-recording", async (req, res) => {
  try {
    console.log("Testing screen recording setup...");

    // Test ffmpeg with a short 2-second recording
    const testPath = "recordings/test-recording.mp4";
    const testArgs = [
      "-f",
      "avfoundation",
      "-framerate",
      "30",
      "-t",
      "2", // Record for 2 seconds
      "-i",
      "1",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-pix_fmt",
      "yuv420p",
      "-y",
      testPath,
    ];

    console.log("Running test recording:", testArgs.join(" "));

    const testProcess = spawn("ffmpeg", testArgs);
    let output = "";

    testProcess.stderr.on("data", (data) => {
      output += data.toString();
    });

    await new Promise((resolve, reject) => {
      testProcess.on("close", (code) => {
        if (code === 0) {
          // Check file size
          try {
            const stats = fs.statSync(testPath);
            console.log(`Test recording created: ${stats.size} bytes`);
            fs.unlinkSync(testPath); // Clean up test file
            resolve();
          } catch (error) {
            reject(new Error("Test recording file not created"));
          }
        } else {
          reject(new Error(`Test recording failed (code ${code}): ${output}`));
        }
      });

      setTimeout(() => reject(new Error("Test recording timeout")), 15000);
    });

    res.json({ success: true, message: "Screen recording test passed!" });
  } catch (error) {
    console.error("Screen recording test failed:", error);
    res.status(500).json({
      success: false,
      error: error.message,
      suggestion:
        "Please check screen recording permissions in System Preferences > Security & Privacy > Privacy > Screen Recording",
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(
    `Test screen recording at: http://localhost:${PORT}/test-recording`
  );
});
