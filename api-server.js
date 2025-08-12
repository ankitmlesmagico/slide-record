const express = require('express');
const puppeteer = require('puppeteer');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3002;

// Configuration
const DISPLAY_NUM = ':99';
const RESOLUTION = '1920x1080';
const RECORDINGS_DIR = 'recordings';

app.use(express.json());
app.use('/recordings', express.static(RECORDINGS_DIR));

// Ensure recordings directory exists
if (!fs.existsSync(RECORDINGS_DIR)) {
    fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
}

// Global process tracking
let xvfbProcess = null;
let wmProcess = null;

// Utility functions
const log = (level, message) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${level}] ${message}`);
};

const checkDependencies = () => {
    const deps = ['xvfb-run', 'google-chrome', 'ffmpeg', 'node'];
    const missing = deps.filter(dep => {
        try {
            require('child_process').execSync(`which ${dep}`, { stdio: 'ignore' });
            return false;
        } catch {
            return true;
        }
    });
    return missing;
};

const startXvfb = () => {
    return new Promise((resolve, reject) => {
        log('INFO', 'Starting virtual display...');
        
        // Kill existing Xvfb
        try {
            require('child_process').execSync(`pkill -f "Xvfb ${DISPLAY_NUM}"`, { stdio: 'ignore' });
        } catch {}
        
        // Start Xvfb
        xvfbProcess = spawn('Xvfb', [
            DISPLAY_NUM,
            '-screen', '0', `${RESOLUTION}x24`,
            '-ac',
            '+extension', 'GLX',
            '+extension', 'RANDR',
            '+extension', 'RENDER',
            '-noreset',
            '-dpi', '96',
            '-fbdir', '/tmp'
        ]);

        xvfbProcess.on('error', reject);
        
        setTimeout(() => {
            if (xvfbProcess && !xvfbProcess.killed) {
                log('SUCCESS', `Virtual display started (PID: ${xvfbProcess.pid})`);
                
                // Start window manager
                process.env.DISPLAY = DISPLAY_NUM;
                try {
                    wmProcess = spawn('fluxbox', [], { env: { ...process.env, DISPLAY: DISPLAY_NUM } });
                    log('INFO', 'Started Fluxbox window manager');
                } catch {
                    try {
                        wmProcess = spawn('openbox', [], { env: { ...process.env, DISPLAY: DISPLAY_NUM } });
                        log('INFO', 'Started Openbox window manager');
                    } catch {}
                }
                
                resolve();
            } else {
                reject(new Error('Failed to start virtual display'));
            }
        }, 3000);
    });
};

const stopXvfb = () => {
    if (wmProcess) {
        log('INFO', 'Stopping window manager...');
        wmProcess.kill();
        wmProcess = null;
    }
    
    if (xvfbProcess) {
        log('INFO', 'Stopping virtual display...');
        xvfbProcess.kill();
        xvfbProcess = null;
    }
};

const convertToPresentUrl = (url) => {
    if (url.includes('/present')) return url;
    return url.replace('/edit', '/present').replace('#', '/present#');
};

const recordSlideshow = async (slideUrl, timings, outputPath) => {
    let browser;
    let ffmpegProcess;
    
    try {
        log('INFO', 'Launching Chrome on virtual display...');
        
        browser = await puppeteer.launch({
            headless: false,
            executablePath: 'google-chrome',
            env: { 
                ...process.env,
                DISPLAY: DISPLAY_NUM 
            },
            ignoreDefaultArgs: [
                '--enable-automation',
                '--enable-blink-features=AutomationControlled'
            ],
            args: [
                '--start-fullscreen',
                '--kiosk',
                '--enable-gpu',
                '--use-gl=swiftshader',
                '--enable-webgl',
                '--enable-accelerated-2d-canvas',
                '--disable-gpu-sandbox',
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-web-security',
                '--disable-features=VizDisplayCompositor',
                '--disable-infobars',
                '--no-first-run',
                '--disable-extensions',
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-renderer-backgrounding',
                '--force-device-scale-factor=1',
                '--high-dpi-support=1',
                '--force-color-profile=srgb',
                '--window-size=1920,1080',
                '--window-position=0,0',
                '--disable-blink-features=AutomationControlled',
                '--disable-ipc-flooding-protection',
                '--disable-xss-auditor',
                '--disable-bundled-ppapi-flash',
                '--disable-plugins-discovery',
                '--ignore-ssl-errors',
                '--ignore-certificate-errors',
                '--ignore-certificate-errors-spki-list',
                '--ignore-ssl-errors-list',
                '--disable-default-apps'
            ]
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
        
        // Remove automation detection
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
            Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
            window.chrome = { runtime: {} };
            Object.defineProperty(navigator, 'permissions', {
                get: () => ({ query: () => Promise.resolve({ state: 'granted' }) })
            });
        });
        
        log('INFO', 'Loading presentation...');
        await page.goto(slideUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(8000);
        
        // Check for login requirement
        const currentUrl = page.url();
        if (currentUrl.includes('accounts.google.com') || currentUrl.includes('signin')) {
            throw new Error('Authentication required. Please ensure the presentation is publicly accessible.');
        }
        
        // Dismiss popups and enter fullscreen
        try {
            await page.keyboard.press('Escape');
            await page.waitForTimeout(1000);
            await page.keyboard.press('F5');
            await page.waitForTimeout(2000);
        } catch {}
        
        log('INFO', 'Starting screen recording...');
        
        // Start FFmpeg recording
        const ffmpegArgs = [
            '-f', 'x11grab',
            '-video_size', RESOLUTION,
            '-framerate', '30',
            '-i', `${DISPLAY_NUM}.0+0,0`,
            '-c:v', 'libx264',
            '-preset', 'medium',
            '-crf', '20',
            '-pix_fmt', 'yuv420p',
            '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
            '-movflags', '+faststart',
            '-y',
            outputPath
        ];
        
        ffmpegProcess = spawn('ffmpeg', ffmpegArgs, { stdio: ['ignore', 'ignore', 'pipe'] });
        
        ffmpegProcess.stderr.on('data', (data) => {
            const output = data.toString().trim();
            if (output.includes('frame=') || output.includes('time=')) {
                log('INFO', `Recording: ${output.split(' ').pop()}`);
            }
        });
        
        await page.waitForTimeout(3000);
        
        // Execute slide transitions
        let currentTime = 0;
        log('INFO', 'Starting slide transitions...');
        
        for (let i = 0; i < timings.length; i++) {
            const waitTime = (timings[i] - currentTime) * 1000;
            if (waitTime > 0) {
                log('INFO', `Waiting ${waitTime/1000}s before advancing to slide ${i + 2}...`);
                await page.waitForTimeout(waitTime);
            }
            
            await page.keyboard.press('ArrowRight');
            await page.waitForTimeout(100);
            
            log('INFO', `Advanced to slide ${i + 2} at ${timings[i]}s`);
            currentTime = timings[i];
        }
        
        log('INFO', 'Recording final slide...');
        await page.waitForTimeout(5000);
        
    } finally {
        if (ffmpegProcess && !ffmpegProcess.killed) {
            log('INFO', 'Stopping screen recording...');
            ffmpegProcess.kill('SIGTERM');
            
            await new Promise(resolve => {
                const timeout = setTimeout(resolve, 5000);
                ffmpegProcess.on('close', () => {
                    clearTimeout(timeout);
                    resolve();
                });
            });
        }
        
        if (browser) {
            log('INFO', 'Closing browser...');
            await browser.close();
        }
    }
};

// API Routes

// Health check
app.get('/health', (req, res) => {
    const missing = checkDependencies();
    res.json({
        status: missing.length === 0 ? 'healthy' : 'unhealthy',
        dependencies: missing.length === 0 ? 'all found' : `missing: ${missing.join(', ')}`,
        timestamp: new Date().toISOString()
    });
});

// Start recording
app.post('/record', async (req, res) => {
    const { slideUrl, timings } = req.body;
    
    // Validate input
    if (!slideUrl || !timings || !Array.isArray(timings)) {
        return res.status(400).json({ 
            error: 'Invalid input. Required: slideUrl (string), timings (array)' 
        });
    }
    
    if (timings.some(t => typeof t !== 'number' || t <= 0)) {
        return res.status(400).json({ 
            error: 'Invalid timings. All values must be positive numbers.' 
        });
    }
    
    const recordingId = uuidv4();
    const outputPath = path.join(RECORDINGS_DIR, `slideshow_${recordingId}.mp4`);
    const presentUrl = convertToPresentUrl(slideUrl);
    
    try {
        log('INFO', `Starting recording for: ${presentUrl}`);
        log('INFO', `Timings: ${timings.join(', ')}`);
        
        // Check dependencies
        const missing = checkDependencies();
        if (missing.length > 0) {
            throw new Error(`Missing dependencies: ${missing.join(', ')}`);
        }
        
        // Start virtual display
        await startXvfb();
        
        // Record slideshow
        await recordSlideshow(presentUrl, timings, outputPath);
        
        // Check if file was created
        if (!fs.existsSync(outputPath)) {
            throw new Error('Recording file was not created');
        }
        
        const stats = fs.statSync(outputPath);
        
        log('SUCCESS', `Recording completed: ${outputPath}`);
        
        res.json({
            success: true,
            recordingId,
            downloadUrl: `/recordings/slideshow_${recordingId}.mp4`,
            fileSize: stats.size,
            fileSizeMB: Math.round(stats.size / 1024 / 1024 * 100) / 100,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        log('ERROR', `Recording failed: ${error.message}`);
        
        // Cleanup failed recording
        if (fs.existsSync(outputPath)) {
            fs.unlinkSync(outputPath);
        }
        
        res.status(500).json({
            error: error.message,
            recordingId,
            timestamp: new Date().toISOString()
        });
    } finally {
        // Always cleanup virtual display
        stopXvfb();
    }
});

// Get recording status/info
app.get('/recording/:id', (req, res) => {
    const { id } = req.params;
    const filePath = path.join(RECORDINGS_DIR, `slideshow_${id}.mp4`);
    
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Recording not found' });
    }
    
    const stats = fs.statSync(filePath);
    
    res.json({
        recordingId: id,
        exists: true,
        fileSize: stats.size,
        fileSizeMB: Math.round(stats.size / 1024 / 1024 * 100) / 100,
        created: stats.birthtime,
        downloadUrl: `/recordings/slideshow_${id}.mp4`
    });
});

// List all recordings
app.get('/recordings', (req, res) => {
    try {
        const files = fs.readdirSync(RECORDINGS_DIR)
            .filter(file => file.endsWith('.mp4'))
            .map(file => {
                const filePath = path.join(RECORDINGS_DIR, file);
                const stats = fs.statSync(filePath);
                const recordingId = file.replace('slideshow_', '').replace('.mp4', '');
                
                return {
                    recordingId,
                    filename: file,
                    fileSize: stats.size,
                    fileSizeMB: Math.round(stats.size / 1024 / 1024 * 100) / 100,
                    created: stats.birthtime,
                    downloadUrl: `/recordings/${file}`
                };
            })
            .sort((a, b) => new Date(b.created) - new Date(a.created));
        
        res.json({
            recordings: files,
            count: files.length,
            totalSizeMB: Math.round(files.reduce((sum, f) => sum + f.fileSizeMB, 0) * 100) / 100
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete recording
app.delete('/recording/:id', (req, res) => {
    const { id } = req.params;
    const filePath = path.join(RECORDINGS_DIR, `slideshow_${id}.mp4`);
    
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Recording not found' });
    }
    
    try {
        fs.unlinkSync(filePath);
        log('INFO', `Deleted recording: ${id}`);
        res.json({ success: true, message: 'Recording deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Cleanup on exit
process.on('SIGINT', () => {
    log('INFO', 'Shutting down...');
    stopXvfb();
    process.exit(0);
});

process.on('SIGTERM', () => {
    log('INFO', 'Shutting down...');
    stopXvfb();
    process.exit(0);
});

app.listen(PORT, () => {
    log('INFO', `Google Slides Recording API Server running on port ${PORT}`);
    log('INFO', `Health check: http://localhost:${PORT}/health`);
    log('INFO', `API Documentation: http://localhost:${PORT}/`);
});

// Root endpoint with API documentation
app.get('/', (req, res) => {
    res.json({
        name: 'Google Slides Recording API',
        version: '1.0.0',
        endpoints: {
            'GET /health': 'Check API health and dependencies',
            'POST /record': 'Start recording (body: {slideUrl, timings})',
            'GET /recording/:id': 'Get recording info',
            'GET /recordings': 'List all recordings',
            'DELETE /recording/:id': 'Delete recording',
            'GET /recordings/:filename': 'Download recording file'
        },
        example: {
            url: 'POST /record',
            body: {
                slideUrl: 'https://docs.google.com/presentation/d/your-id/edit',
                timings: [5, 8, 12, 20]
            }
        }
    });
});