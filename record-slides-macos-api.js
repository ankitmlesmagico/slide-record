const puppeteer = require("puppeteer");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { uploadToMinIO } = require("./minio-config");

/**
 * Record Google Slides presentation on macOS
 * This version works directly without shell script dependencies
 */
async function recordSlidesOnMacOS(slideUrl, timings, outputPath) {
  let browser;
  let ffmpegProcess;
  const tempDir = path.join(__dirname, 'temp_screenshots');
  
  try {
    console.log('Starting virtual recording...');
    console.log('URL:', slideUrl);
    console.log('Timings:', timings);
    console.log('Output:', outputPath);
    
    // Create temp directory for screenshots
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    // Convert URL to presentation mode if needed
    const presentUrl = slideUrl.includes('/present') 
      ? slideUrl 
      : slideUrl.replace('/edit', '/present').replace('#', '/present#');
    
    console.log('Presentation URL:', presentUrl);
    
    // Launch Chrome in headless mode (virtual display)
    browser = await puppeteer.launch({
      headless: true, // Virtual display - no visible window
      executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      ignoreDefaultArgs: [
        '--enable-automation',
        '--enable-blink-features=AutomationControlled'
      ],
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--force-device-scale-factor=1',
        '--window-size=1920,1080',
        '--disable-infobars',
        '--no-first-run',
        '--disable-extensions',
        '--enable-gpu',
        '--use-gl=swiftshader'
      ]
    });

    const page = await browser.newPage();
    
    // Set viewport for virtual display
    await page.setViewport({ 
      width: 1920, 
      height: 1080,
      deviceScaleFactor: 1
    });
    
    // Remove automation detection
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { 
        get: () => undefined 
      });
      
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5]
      });
      
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en']
      });
      
      window.chrome = {
        runtime: {}
      };
    });
    
    console.log('Loading presentation in virtual display...');
    
    // Load the presentation
    await page.goto(presentUrl, { 
      waitUntil: 'networkidle2',
      timeout: 60000
    });
    
    // Wait for presentation to load
    await page.waitForTimeout(8000);
    
    // Try to dismiss any popups
    try {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(1000);
    } catch (e) {
      // Ignore
    }
    
    // Try to enter presentation mode
    try {
      await page.keyboard.press('F5');
      await page.waitForTimeout(2000);
    } catch (e) {
      console.log('F5 key press failed, continuing...');
    }
    
    console.log('Starting virtual screen capture...');
    
    // Start FFmpeg to create video from screenshots
    const ffmpegArgs = [
      '-f', 'image2pipe',
      '-r', '30', // 30 fps
      '-i', '-', // Read from stdin
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '20',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-y',
      outputPath
    ];
    
    console.log('Starting FFmpeg for virtual recording...');
    ffmpegProcess = spawn('ffmpeg', ffmpegArgs);
    
    let frameCount = 0;
    ffmpegProcess.stderr.on('data', (data) => {
      const output = data.toString().trim();
      if (output.includes('frame=')) {
        frameCount++;
        if (frameCount % 90 === 0) { // Log every 3 seconds at 30fps
          console.log('Recording progress:', output.split(' ').slice(-3).join(' '));
        }
      }
    });
    
    // Function to capture and send frame to FFmpeg
    const captureFrame = async () => {
      try {
        const screenshot = await page.screenshot({ 
          type: 'png',
          fullPage: false
        });
        if (ffmpegProcess && !ffmpegProcess.killed) {
          ffmpegProcess.stdin.write(screenshot);
        }
      } catch (error) {
        console.error('Screenshot error:', error);
      }
    };
    
    // Start capturing frames at 30fps
    const frameInterval = setInterval(captureFrame, 1000/30); // 33.33ms for 30fps
    
    // Wait a bit before starting slide transitions
    await page.waitForTimeout(3000);
    
    // Execute slide transitions
    let currentTime = 0;
    console.log('Starting slide transitions in virtual display...');
    
    for (let i = 0; i < timings.length; i++) {
      const waitTime = (timings[i] - currentTime) * 1000;
      if (waitTime > 0) {
        console.log(`Waiting ${waitTime/1000}s before advancing to slide ${i + 2}...`);
        await page.waitForTimeout(waitTime);
      }
      
      // Advance slide
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(200);
      
      console.log(`Advanced to slide ${i + 2} at ${timings[i]}s`);
      currentTime = timings[i];
    }
    
    // Wait for final slide
    console.log('Recording final slide...');
    await page.waitForTimeout(5000);
    
    // Stop frame capture
    clearInterval(frameInterval);
    
    // Send final frame and close FFmpeg stdin
    await captureFrame();
    if (ffmpegProcess && !ffmpegProcess.killed) {
      ffmpegProcess.stdin.end();
    }
    
    // Wait for FFmpeg to complete
    await new Promise(resolve => {
      const timeout = setTimeout(resolve, 10000);
      ffmpegProcess.on('close', (code) => {
        clearTimeout(timeout);
        console.log(`FFmpeg finished with code: ${code}`);
        resolve();
      });
    });
    
    // Check if file was created successfully
    if (!fs.existsSync(outputPath)) {
      throw new Error('Recording file was not created');
    }
    
    console.log('📤 Uploading recording to MinIO...');
    
    // Generate object name for MinIO
    const fileName = path.basename(outputPath);
    const objectName = `recordings/${fileName}`;
    
    // Upload to MinIO
    const videoUrl = await uploadToMinIO(outputPath, objectName);
    
    // Clean up local file after upload
    try {
      fs.unlinkSync(outputPath);
      console.log('🗑️ Cleaned up local file');
    } catch (e) {
      console.error('Warning: Failed to cleanup local file:', e);
    }
    
    return { 
      success: true, 
      videoUrl: videoUrl,
      fileName: fileName
    };
    
  } catch (error) {
    console.error('Virtual recording error:', error);
    return { success: false, error: error.message };
  } finally {
    // Stop recording
    if (ffmpegProcess && !ffmpegProcess.killed) {
      console.log('Stopping virtual screen recording...');
      
      // Wait for FFmpeg to finish processing
      await new Promise(resolve => {
        const timeout = setTimeout(resolve, 10000); // 10 second timeout
        ffmpegProcess.on('close', (code) => {
          clearTimeout(timeout);
          console.log(`FFmpeg finished with code: ${code}`);
          resolve();
        });
      });
    }
    
    // Close browser
    if (browser) {
      console.log('Closing virtual browser...');
      await browser.close();
    }
    
    // Cleanup temp directory
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch (e) {
      console.error('Cleanup error:', e);
    }
  }
}

module.exports = { recordSlidesOnMacOS };
