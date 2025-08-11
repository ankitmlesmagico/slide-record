const express = require('express');
const puppeteer = require('puppeteer');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 3001; // Different port

app.use(express.json());
app.use(express.static('public'));
app.use('/recordings', express.static('recordings'));

// Ensure recordings directory exists
if (!fs.existsSync('recordings')) {
    fs.mkdirSync('recordings');
}

let xvfbProcess = null;
const DISPLAY = ':99';
const RESOLUTION = '1440x810';

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

async function startXvfb() {
    return new Promise((resolve, reject) => {
        console.log('Starting Xvfb virtual display...');
        xvfbProcess = spawn('Xvfb', [
            DISPLAY,
            '-screen', '0', `${RESOLUTION}x24`,
            '-ac',
            '+extension', 'GLX',
            '+render',
            '-noreset'
        ]);

        xvfbProcess.on('error', (err) => {
            console.error('Xvfb error:', err);
            reject(err);
        });

        // Wait for Xvfb to start
        setTimeout(() => {
            console.log(`Xvfb started on display ${DISPLAY}`);
            resolve();
        }, 2000);
    });
}

function stopXvfb() {
    if (xvfbProcess) {
        console.log('Stopping Xvfb...');
        xvfbProcess.kill();
        xvfbProcess = null;
    }
}

async function recordSlideshow(slideUrl, timings, outputPath) {
    let browser;
    let ffmpegProcess;
    
    try {
        // Start virtual display
        await startXvfb();
        
        // Launch browser on virtual display
        console.log('Launching Chrome on virtual display...');
        browser = await puppeteer.launch({
            headless: false,
            executablePath: '/usr/bin/google-chrome',
            env: { 
                ...process.env,
                DISPLAY: DISPLAY 
            },
            ignoreDefaultArgs: [
                            '--enable-automation',
                            '--enable-blink-features=AutomationControlled'
                        ],
            args: [
                '--start-fullscreen',
                '--enable-gpu',
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-web-security'
            ]
        });

        const page = await browser.newPage();
        const [width, height] = RESOLUTION.split('x').map(Number);
        await page.setViewport({ width, height });
        
        // Convert regular slides URL to presentation mode
        const presentUrl = slideUrl.includes('/present') 
            ? slideUrl 
            : slideUrl.replace('/edit', '/present').replace('#', '/present#');
        
        console.log('Opening presentation:', presentUrl);
        await page.goto(presentUrl, { waitUntil: 'networkidle2' });
        
        // Wait for presentation to load
        await page.waitForTimeout(3000);
        
        // Start recording from virtual display
        console.log('Starting recording from virtual display...');
        ffmpegProcess = startVirtualRecording(outputPath);
        
        // Wait for recording to start
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
        // Stop recording first
        if (ffmpegProcess) {
            console.log('Stopping recording...');
            ffmpegProcess.kill('SIGTERM');
            await new Promise(resolve => {
                ffmpegProcess.on('close', resolve);
                setTimeout(resolve, 3000);
            });
        }
        
        // Close browser
        if (browser) {
            console.log('Closing browser...');
            await browser.close();
        }
        
        // Stop virtual display
        stopXvfb();
    }
}

function startVirtualRecording(outputPath) {
    const ffmpegArgs = [
        '-f', 'x11grab',
        '-r', '30',
        '-s', RESOLUTION,
        '-i', `${DISPLAY}.0+0,0`,
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', '23',
        '-pix_fmt', 'yuv420p',
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

// Cleanup on exit
process.on('SIGINT', () => {
    stopXvfb();
    process.exit();
});

process.on('SIGTERM', () => {
    stopXvfb();
    process.exit();
});

app.listen(PORT, () => {
    console.log(`Virtual Display Server running at http://localhost:${PORT}`);
    console.log('This version uses Xvfb virtual display - no visible windows!');
});