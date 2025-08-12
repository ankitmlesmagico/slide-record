const express = require('express');
const puppeteer = require('puppeteer');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3003;

// Configuration
const DISPLAY_NUM = ':99';
const RESOLUTION = '1920x1080';
const RECORDINGS_DIR = 'recordings';

// Enhanced JSON middleware with error handling
app.use(express.json({
    limit: '10mb',
    strict: true,
    type: 'application/json'
}));

// JSON error handling middleware
app.use((error, req, res, next) => {
    if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
        log('ERROR', `Invalid JSON in request: ${error.message}`);
        return res.status(400).json({
            error: 'Invalid JSON format in request body',
            details: error.message
        });
    }
    next(error);
});

app.use('/recordings', express.static(RECORDINGS_DIR));

// CORS middleware
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    if (req.method === 'OPTIONS') {
        res.sendStatus(200);
    } else {
        next();
    }
});

// Ensure recordings directory exists
if (!fs.existsSync(RECORDINGS_DIR)) {
    fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
}

// Global process tracking
let xvfbProcess = null;
let wmProcess = null;
let activeRecordings = new Map();

// Utility functions
const log = (level, message, recordingId = null) => {
    const timestamp = new Date().toISOString();
    const prefix = recordingId ? `[${recordingId.slice(0, 8)}]` : '';
    console.log(`[${timestamp}] [${level}] ${prefix} ${message}`);
};

const checkDependencies = () => {
    const deps = [
        { cmd: 'xvfb-run', name: 'xvfb' },
        { cmd: 'google-chrome', name: 'google-chrome', alt: 'chromium-browser' },
        { cmd: 'ffmpeg', name: 'ffmpeg' },
        { cmd: 'node', name: 'nodejs' }
    ];

    const missing = [];

    for (const dep of deps) {
        try {
            require('child_process').execSync(`which ${dep.cmd}`, { stdio: 'ignore' });
        } catch {
            if (dep.alt) {
                try {
                    require('child_process').execSync(`which ${dep.alt}`, { stdio: 'ignore' });
                    continue;
                } catch { }
            }
            missing.push(dep.name);
        }
    }

    return missing;
};

const getChromeExecutable = () => {
    try {
        require('child_process').execSync('which google-chrome', { stdio: 'ignore' });
        return 'google-chrome';
    } catch {
        try {
            require('child_process').execSync('which chromium-browser', { stdio: 'ignore' });
            return 'chromium-browser';
        } catch {
            throw new Error('No Chrome/Chromium executable found');
        }
    }
};

const startXvfb = () => {
    return new Promise((resolve, reject) => {
        log('INFO', 'Starting virtual display...');

        // Kill existing Xvfb
        try {
            require('child_process').execSync(`pkill -f "Xvfb ${DISPLAY_NUM}"`, { stdio: 'ignore' });
            log('INFO', 'Killed existing Xvfb processes');
        } catch { }

        setTimeout(() => {
            // Start Xvfb with enhanced settings
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

            xvfbProcess.on('error', (err) => {
                log('ERROR', `Xvfb error: ${err.message}`);
                reject(err);
            });

            setTimeout(() => {
                if (xvfbProcess && !xvfbProcess.killed) {
                    log('SUCCESS', `Virtual display started (PID: ${xvfbProcess.pid})`);

                    // Start window manager for better rendering (optional)
                    process.env.DISPLAY = DISPLAY_NUM;
                    
                    // Check if fluxbox is available
                    try {
                        require('child_process').execSync('which fluxbox', { stdio: 'ignore' });
                        wmProcess = spawn('fluxbox', [], {
                            env: { ...process.env, DISPLAY: DISPLAY_NUM },
                            stdio: 'ignore'
                        });
                        wmProcess.on('error', (err) => {
                            log('WARNING', `Fluxbox failed to start: ${err.message}`);
                            wmProcess = null;
                        });
                        log('INFO', 'Started Fluxbox window manager');
                    } catch {
                        // Try openbox
                        try {
                            require('child_process').execSync('which openbox', { stdio: 'ignore' });
                            wmProcess = spawn('openbox', [], {
                                env: { ...process.env, DISPLAY: DISPLAY_NUM },
                                stdio: 'ignore'
                            });
                            wmProcess.on('error', (err) => {
                                log('WARNING', `Openbox failed to start: ${err.message}`);
                                wmProcess = null;
                            });
                            log('INFO', 'Started Openbox window manager');
                        } catch {
                            log('WARNING', 'No window manager available (fluxbox/openbox not found)');
                            log('INFO', 'Recording will continue without window manager');
                        }
                    }

                    setTimeout(resolve, 2000);
                } else {
                    reject(new Error('Failed to start virtual display'));
                }
            }, 3000);
        }, 1000);
    });
};

const stopXvfb = () => {
    if (wmProcess && !wmProcess.killed) {
        log('INFO', 'Stopping window manager...');
        wmProcess.kill('SIGTERM');
        wmProcess = null;
    }

    if (xvfbProcess && !xvfbProcess.killed) {
        log('INFO', 'Stopping virtual display...');
        xvfbProcess.kill('SIGTERM');
        xvfbProcess = null;
    }
};

const convertToPresentUrl = (url) => {
    if (url.includes('/present')) return url;
    return url.replace('/edit', '/present').replace('#', '/present#');
};

const recordSlideshow = async (slideUrl, timings, outputPath, recordingId) => {
    let browser;
    let ffmpegProcess;

    try {
        log('INFO', 'Launching Chrome on virtual display...', recordingId);

        const chromeExec = getChromeExecutable();

        browser = await puppeteer.launch({
            headless: false,
            executablePath: chromeExec,
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
                '--disable-default-apps',
                '--enable-logging',
                '--log-level=0'
            ]
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });

        // Enhanced automation detection removal
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
            Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
            window.chrome = { runtime: {} };
            Object.defineProperty(navigator, 'permissions', {
                get: () => ({ query: () => Promise.resolve({ state: 'granted' }) })
            });
        });

        log('INFO', 'Loading presentation...', recordingId);

        // Multiple loading strategies
        try {
            await page.goto(slideUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
            log('INFO', 'Page loaded with domcontentloaded', recordingId);
        } catch (firstError) {
            log('INFO', 'First attempt failed, trying with networkidle2...', recordingId);
            try {
                await page.goto(slideUrl, { waitUntil: 'networkidle2', timeout: 45000 });
                log('INFO', 'Page loaded with networkidle2', recordingId);
            } catch (secondError) {
                log('INFO', 'Second attempt failed, trying basic load...', recordingId);
                await page.goto(slideUrl, { waitUntil: 'load', timeout: 30000 });
                log('INFO', 'Page loaded with basic load', recordingId);
            }
        }

        await page.waitForTimeout(8000);

        // Check for authentication requirement
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
        } catch (e) {
            log('INFO', 'Popup dismissal failed, continuing...', recordingId);
        }

        log('INFO', 'Starting screen recording...', recordingId);

        // Enhanced FFmpeg settings
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

        // Track recording progress
        let recordingStarted = false;
        ffmpegProcess.stderr.on('data', (data) => {
            const output = data.toString().trim();
            if (output.includes('frame=') || output.includes('time=')) {
                if (!recordingStarted) {
                    recordingStarted = true;
                    log('SUCCESS', 'Screen recording started', recordingId);
                }
                // Update recording status
                if (activeRecordings.has(recordingId)) {
                    const status = activeRecordings.get(recordingId);
                    status.lastUpdate = new Date();
                    status.ffmpegOutput = output.split(' ').pop();
                }
            }
        });

        await page.waitForTimeout(3000);

        // Execute slide transitions with precise timing
        let currentTime = 0;
        log('INFO', 'Starting slide transitions...', recordingId);

        for (let i = 0; i < timings.length; i++) {
            const waitTime = (timings[i] - currentTime) * 1000;
            if (waitTime > 0) {
                log('INFO', `Waiting ${waitTime / 1000}s before advancing to slide ${i + 2}...`, recordingId);
                await page.waitForTimeout(waitTime);
            }

            // Multiple methods to advance slides
            await page.keyboard.press('ArrowRight');
            await page.waitForTimeout(100);

            log('INFO', `Advanced to slide ${i + 2} at ${timings[i]}s`, recordingId);
            currentTime = timings[i];
        }

        log('INFO', 'Recording final slide...', recordingId);
        await page.waitForTimeout(5000);

    } finally {
        if (ffmpegProcess && !ffmpegProcess.killed) {
            log('INFO', 'Stopping screen recording...', recordingId);
            ffmpegProcess.kill('SIGTERM');

            await new Promise(resolve => {
                const timeout = setTimeout(resolve, 10000);
                ffmpegProcess.on('close', () => {
                    clearTimeout(timeout);
                    resolve();
                });
            });
        }

        if (browser) {
            log('INFO', 'Closing browser...', recordingId);
            await browser.close();
        }
    }
};

// API Routes

// Simple test endpoint for debugging
app.post('/test', (req, res) => {
    log('INFO', 'Test endpoint called');
    log('INFO', `Content-Type: ${req.get('Content-Type')}`);
    log('INFO', `Body: ${JSON.stringify(req.body)}`);

    res.json({
        success: true,
        received: req.body,
        contentType: req.get('Content-Type'),
        bodyType: typeof req.body
    });
});

// Health check with detailed system info
app.get('/health', (req, res) => {
    const missing = checkDependencies();
    const systemInfo = {
        platform: process.platform,
        nodeVersion: process.version,
        memory: process.memoryUsage(),
        uptime: process.uptime(),
        activeRecordings: activeRecordings.size
    };

    res.json({
        status: missing.length === 0 ? 'healthy' : 'unhealthy',
        dependencies: missing.length === 0 ? 'all found' : `missing: ${missing.join(', ')}`,
        system: systemInfo,
        timestamp: new Date().toISOString()
    });
});

// Start recording - Main API endpoint
app.post('/record', async (req, res) => {
    // Log the raw request for debugging
    log('INFO', `Received POST /record request`);
    log('INFO', `Content-Type: ${req.get('Content-Type')}`);
    log('INFO', `Body type: ${typeof req.body}`);

    if (!req.body || typeof req.body !== 'object') {
        return res.status(400).json({
            error: 'Request body must be valid JSON object',
            received: typeof req.body,
            contentType: req.get('Content-Type')
        });
    }

    const { slideUrl, timings } = req.body;

    // Comprehensive input validation
    if (!slideUrl || typeof slideUrl !== 'string') {
        return res.status(400).json({
            error: 'Invalid slideUrl. Must be a valid Google Slides URL string.'
        });
    }

    if (!timings || !Array.isArray(timings) || timings.length === 0) {
        return res.status(400).json({
            error: 'Invalid timings. Must be a non-empty array of positive numbers.'
        });
    }

    if (timings.some(t => typeof t !== 'number' || t <= 0 || !isFinite(t))) {
        return res.status(400).json({
            error: 'Invalid timings. All values must be positive finite numbers.'
        });
    }

    // Check for valid Google Slides URL
    if (!slideUrl.includes('docs.google.com/presentation')) {
        return res.status(400).json({
            error: 'Invalid URL. Must be a Google Slides presentation URL.'
        });
    }

    // Check if system is busy
    if (activeRecordings.size > 0) {
        return res.status(429).json({
            error: 'System busy. Another recording is in progress. Please wait.',
            activeRecordings: activeRecordings.size
        });
    }

    const recordingId = uuidv4();
    const outputPath = path.join(RECORDINGS_DIR, `slideshow_${recordingId}.mp4`);
    const presentUrl = convertToPresentUrl(slideUrl);

    // Track recording status
    activeRecordings.set(recordingId, {
        status: 'starting',
        slideUrl: presentUrl,
        timings,
        startTime: new Date(),
        lastUpdate: new Date()
    });

    // Send immediate response
    res.json({
        success: true,
        recordingId,
        status: 'started',
        message: 'Recording started. Use GET /recording/:id to check progress.',
        estimatedDuration: Math.max(...timings) + 10,
        timestamp: new Date().toISOString()
    });

    // Start recording asynchronously
    (async () => {
        try {
            log('INFO', `Starting recording for: ${presentUrl}`, recordingId);
            log('INFO', `Timings: ${timings.join(', ')}`, recordingId);

            // Update status
            activeRecordings.get(recordingId).status = 'checking_dependencies';

            // Check dependencies
            const missing = checkDependencies();
            if (missing.length > 0) {
                throw new Error(`Missing dependencies: ${missing.join(', ')}`);
            }

            // Update status
            activeRecordings.get(recordingId).status = 'starting_virtual_display';

            // Start virtual display
            await startXvfb();

            // Update status
            activeRecordings.get(recordingId).status = 'recording';

            // Record slideshow
            await recordSlideshow(presentUrl, timings, outputPath, recordingId);

            // Check if file was created and has content
            if (!fs.existsSync(outputPath)) {
                throw new Error('Recording file was not created');
            }

            const stats = fs.statSync(outputPath);
            if (stats.size === 0) {
                throw new Error('Recording file is empty');
            }

            // Update final status
            activeRecordings.set(recordingId, {
                ...activeRecordings.get(recordingId),
                status: 'completed',
                endTime: new Date(),
                fileSize: stats.size,
                fileSizeMB: Math.round(stats.size / 1024 / 1024 * 100) / 100,
                downloadUrl: `/recordings/slideshow_${recordingId}.mp4`
            });

            log('SUCCESS', `Recording completed: ${outputPath}`, recordingId);

        } catch (error) {
            log('ERROR', `Recording failed: ${error.message}`, recordingId);

            // Update error status
            if (activeRecordings.has(recordingId)) {
                activeRecordings.set(recordingId, {
                    ...activeRecordings.get(recordingId),
                    status: 'failed',
                    error: error.message,
                    endTime: new Date()
                });
            }

            // Cleanup failed recording
            if (fs.existsSync(outputPath)) {
                try {
                    fs.unlinkSync(outputPath);
                } catch { }
            }
        } finally {
            // Always cleanup virtual display
            stopXvfb();

            // Remove from active recordings after 5 minutes
            setTimeout(() => {
                activeRecordings.delete(recordingId);
            }, 5 * 60 * 1000);
        }
    })();
});

// Get recording status/info
app.get('/recording/:id', (req, res) => {
    const { id } = req.params;

    // Check if recording is active
    if (activeRecordings.has(id)) {
        const recording = activeRecordings.get(id);
        return res.json({
            recordingId: id,
            ...recording,
            duration: new Date() - recording.startTime
        });
    }

    // Check if file exists
    const filePath = path.join(RECORDINGS_DIR, `slideshow_${id}.mp4`);
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Recording not found' });
    }

    const stats = fs.statSync(filePath);

    res.json({
        recordingId: id,
        status: 'completed',
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
            .filter(file => file.endsWith('.mp4') && file.startsWith('slideshow_'))
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
            active: Array.from(activeRecordings.entries()).map(([id, data]) => ({
                recordingId: id,
                ...data
            })),
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
const cleanup = () => {
    log('INFO', 'Shutting down server...');
    stopXvfb();
    process.exit(0);
};

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

// Root endpoint with comprehensive API documentation
app.get('/', (req, res) => {
    res.json({
        name: 'Google Slides Recording API',
        version: '2.0.0',
        description: 'Automated recording of Google Slides presentations with virtual display',
        endpoints: {
            'GET /': 'API documentation',
            'GET /health': 'Check API health and dependencies',
            'POST /record': 'Start recording (body: {slideUrl, timings})',
            'GET /recording/:id': 'Get recording status/info',
            'GET /recordings': 'List all recordings and active sessions',
            'DELETE /recording/:id': 'Delete recording',
            'GET /recordings/:filename': 'Download recording file'
        },
        usage: {
            record: {
                method: 'POST',
                url: '/record',
                body: {
                    slideUrl: 'https://docs.google.com/presentation/d/your-presentation-id/edit',
                    timings: [5, 8, 12, 20]
                },
                description: 'timings array represents seconds when to advance to next slide'
            },
            checkStatus: {
                method: 'GET',
                url: '/recording/{recordingId}',
                description: 'Check recording progress or get completed recording info'
            }
        },
        requirements: {
            system: ['Linux with X11', 'Xvfb', 'Google Chrome/Chromium', 'FFmpeg', 'Node.js'],
            optional: ['Fluxbox or Openbox window manager for better rendering']
        }
    });
});

app.listen(PORT, () => {
    log('INFO', `Google Slides Recording API Server running on port ${PORT}`);
    log('INFO', `Health check: http://localhost:${PORT}/health`);
    log('INFO', `API Documentation: http://localhost:${PORT}/`);

    // Initial dependency check
    const missing = checkDependencies();
    if (missing.length > 0) {
        log('WARNING', `Missing dependencies: ${missing.join(', ')}`);
        log('WARNING', 'Install with: sudo apt install xvfb google-chrome-stable ffmpeg nodejs npm fluxbox');
    } else {
        log('SUCCESS', 'All dependencies found');
    }
});