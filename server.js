const express = require('express');
const puppeteer = require('puppeteer');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static('public'));
app.use('/recordings', express.static('recordings'));

// Ensure recordings directory exists
if (!fs.existsSync('recordings')) {
    fs.mkdirSync('recordings');
}

app.post('/record', async (req, res) => {
    const { slideUrl, timings } = req.body;
    
    if (!slideUrl || !timings || !Array.isArray(timings)) {
        return res.status(400).json({ error: 'Invalid input' });
    }

    const recordingId = uuidv4();
    const outputPath = `recordings/${recordingId}.mp4`;
    
    try {
        await recordSlideshow(slideUrl, timings, outputPath);
        res.json({ 
            success: true, 
            downloadUrl: `/recordings/${recordingId}.mp4`,
            recordingId 
        });
    } catch (error) {
        console.error('Recording failed:', error);
        res.status(500).json({ error: 'Recording failed: ' + error.message });
    }
});

async function recordSlideshow(slideUrl, timings, outputPath) {
    let browser;
    let ffmpegProcess;
    
    try {
        // Launch browser
        browser = await puppeteer.launch({
            headless: false,
            executablePath: '/usr/bin/google-chrome',
            args: [
                '--start-fullscreen',
                '--disable-web-security',
                '--disable-features=VizDisplayCompositor',
                '--no-sandbox',
                '--disable-setuid-sandbox'
            ]
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 1440, height: 810 });
        
        // Convert regular slides URL to presentation mode
        const presentUrl = slideUrl.includes('/present') 
            ? slideUrl 
            : slideUrl.replace('/edit', '/present').replace('#', '/present#');
        
        console.log('Opening presentation:', presentUrl);
        await page.goto(presentUrl, { waitUntil: 'networkidle2' });
        
        // Wait for presentation to load
        await page.waitForTimeout(3000);
        
        // Get window info for recording
        const windowInfo = await getWindowInfo();
        
        // Start recording
        ffmpegProcess = startRecording(windowInfo, outputPath);
        
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
            await page.keyboard.press('ArrowRight');
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
            ffmpegProcess.kill('SIGTERM');
            await new Promise(resolve => {
                ffmpegProcess.on('close', resolve);
                setTimeout(resolve, 5000); // Force resolve after 5s
            });
        }
    }
}

async function getScreenResolution() {
    return new Promise((resolve) => {
        const xrandr = spawn('xrandr');
        let output = '';
        
        xrandr.stdout.on('data', (data) => {
            output += data.toString();
        });
        
        xrandr.on('close', () => {
            const match = output.match(/(\d+)x(\d+).*\*/);
            if (match) {
                resolve({ width: parseInt(match[1]), height: parseInt(match[2]) });
            } else {
                resolve({ width: 1440, height: 810 });
            }
        });
        
        xrandr.on('error', () => {
            resolve({ width: 1440, height: 810 });
        });
    });
}

function getWindowInfo() {
    return new Promise(async (resolve) => {
        const screenRes = await getScreenResolution();
        console.log('Screen resolution:', screenRes);
        resolve({ x: 0, y: 0, width: screenRes.width, height: screenRes.height });
    });
}

function startRecording(windowInfo, outputPath) {
    const ffmpegArgs = [
        '-f', 'x11grab',
        '-r', '30',
        '-s', `${windowInfo.width}x${windowInfo.height}`,
        '-i', `:0.0+${windowInfo.x},${windowInfo.y}`,
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', '23',
        '-y',
        outputPath
    ];
    
    console.log('Starting ffmpeg with args:', ffmpegArgs);
    const ffmpeg = spawn('ffmpeg', ffmpegArgs);
    
    ffmpeg.stderr.on('data', (data) => {
        console.log('FFmpeg:', data.toString());
    });
    
    return ffmpeg;
}

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});