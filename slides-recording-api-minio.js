const express = require('express');
const puppeteer = require('puppeteer');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const Minio = require('minio');

const app = express();
const PORT = process.env.PORT || 3003;

// Configuration
const DISPLAY_NUM = ':99';
const RESOLUTION = '1920x1080';
const TEMP_DIR = 'temp-recordings'; // Temporary local storage before upload

// MinIO Configuration
const MINIO_CONFIG = {
    endPoint: process.env.MINIO_ENDPOINT || 'localhost',
    port: parseInt(process.env.MINIO_PORT) || 9000,
    useSSL: process.env.MINIO_USE_SSL === 'true' || false,
    accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
    secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin'
};

const MINIO_BUCKET = process.env.MINIO_BUCKET || 'slide-recordings';

// Initialize MinIO client
const minioClient = new Minio.Client(MINIO_CONFIG);

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

// Ensure temp directory exists
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
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

// MinIO utility functions
const initializeMinIO = async () => {
    try {
        log('INFO', 'Initializing MinIO connection...');
        
        // Check if bucket exists, create if not
        const bucketExists = await minioClient.bucketExists(MINIO_BUCKET);
        if (!bucketExists) {
            await minioClient.makeBucket(MINIO_BUCKET, 'us-east-1');
            log('SUCCESS', `Created MinIO bucket: ${MINIO_BUCKET}`);
        } else {
            log('SUCCESS', `MinIO bucket exists: ${MINIO_BUCKET}`);
        }
        
        // Set bucket policy to allow public read access for recordings
        const policy = {
            Version: '2012-10-17',
            Statement: [
                {
                    Effect: 'Allow',
                    Principal: { AWS: ['*'] },
                    Action: ['s3:GetObject'],
                    Resource: [`arn:aws:s3:::${MINIO_BUCKET}/*`]
                }
            ]
        };
        
        await minioClient.setBucketPolicy(MINIO_BUCKET, JSON.stringify(policy));
        log('SUCCESS', 'MinIO bucket policy set for public read access');
        
        return true;
    } catch (error) {
        log('ERROR', `MinIO initialization failed: ${error.message}`);
        return false;
    }
};

const uploadToMinIO = async (filePath, objectName, recordingId) => {
    try {
        log('INFO', `Uploading to MinIO: ${objectName}`, recordingId);
        
        const stats = fs.statSync(filePath);
        const metaData = {
            'Content-Type': 'video/mp4',
            'Content-Length': stats.size,
            'X-Recording-ID': recordingId,
            'X-Upload-Time': new Date().toISOString()
        };
        
        await minioClient.fPutObject(MINIO_BUCKET, objectName, filePath, metaData);
        
        // Generate public URL
        const protocol = MINIO_CONFIG.useSSL ? 'https' : 'http';
        const port = MINIO_CONFIG.port === (MINIO_CONFIG.useSSL ? 443 : 80) ? '' : `:${MINIO_CONFIG.port}`;
        const publicUrl = `${protocol}://${MINIO_CONFIG.endPoint}${port}/${MINIO_BUCKET}/${objectName}`;
        
        log('SUCCESS', `Uploaded to MinIO: ${publicUrl}`, recordingId);
        return publicUrl;
    } catch (error) {
        log('ERROR', `MinIO upload failed: ${error.message}`, recordingId);
        throw error;
    }
};

const deleteFromMinIO = async (objectName) => {
    try {
        await minioClient.removeObject(MINIO_BUCKET, objectName);
        log('SUCCESS', `Deleted from MinIO: ${objectName}`);
        return true;
    } catch (error) {
        log('ERROR', `MinIO delete failed: ${error.message}`);
        return false;
    }
};

const listMinIORecordings = async () => {
    try {
        const recordings = [];
        const stream = minioClient.listObjects(MINIO_BUCKET, '', true);
        
        return new Promise((resolve, reject) => {
            stream.on('data', (obj) => {
                if (obj.name.endsWith('.mp4')) {
                    const protocol = MINIO_CONFIG.useSSL ? 'https' : 'http';
                    const port = MINIO_CONFIG.port === (MINIO_CONFIG.useSSL ? 443 : 80) ? '' : `:${MINIO_CONFIG.port}`;
                    const publicUrl = `${protocol}://${MINIO_CONFIG.endPoint}${port}/${MINIO_BUCKET}/${obj.name}`;
                    
                    recordings.push({
                        recordingId: obj.name.replace('slideshow_', '').replace('.mp4', ''),
                        filename: obj.name,
                        fileSize: obj.size,
                        fileSizeMB: Math.round(obj.size / 1024 / 1024 * 100) / 100,
                        lastModified: obj.lastModified,
                        downloadUrl: publicUrl,
                        etag: obj.etag
                    });
                }
            });
            
            stream.on('end', () => {
                recordings.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));
                resolve(recordings);
            });
            
            stream.on('error', reject);
        });
    } catch (error) {
        log('ERROR', `Failed to list MinIO recordings: ${error.message}`);
        return [];
    }
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

        await new Promise(resolve => setTimeout(resolve, 8000));

        // Check for authentication requirement
        const currentUrl = page.url();
        if (currentUrl.includes('accounts.google.com') || currentUrl.includes('signin')) {
            throw new Error('Authentication required. Please ensure the presentation is publicly accessible.');
        }

        // Dismiss popups and enter fullscreen
        try {
            await page.keyboard.press('Escape');
            await new Promise(resolve => setTimeout(resolve, 1000));
            await page.keyboard.press('F5');
            await new Promise(resolve => setTimeout(resolve, 2000));
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

        await new Promise(resolve => setTimeout(resolve, 3000));

        // Execute slide transitions with precise timing
        let currentTime = 0;
        log('INFO', 'Starting slide transitions...', recordingId);

        for (let i = 0; i < timings.length; i++) {
            const waitTime = (timings[i] - currentTime) * 1000;
            if (waitTime > 0) {
                log('INFO', `Waiting ${waitTime / 1000}s before advancing to slide ${i + 2}...`, recordingId);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }

            // Multiple methods to advance slides
            await page.keyboard.press('ArrowRight');
            await new Promise(resolve => setTimeout(resolve, 100));

            log('INFO', `Advanced to slide ${i + 2} at ${timings[i]}s`, recordingId);
            currentTime = timings[i];
        }

        log('INFO', 'Recording final slide...', recordingId);
        await new Promise(resolve => setTimeout(resolve, 5000));

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

// Health check with MinIO status
app.get('/health', async (req, res) => {
    const missing = checkDependencies();
    const systemInfo = {
        platform: process.platform,
        nodeVersion: process.version,
        memory: process.memoryUsage(),
        uptime: process.uptime(),
        activeRecordings: activeRecordings.size
    };

    // Check MinIO connection
    let minioStatus = 'unknown';
    try {
        await minioClient.bucketExists(MINIO_BUCKET);
        minioStatus = 'connected';
    } catch (error) {
        minioStatus = `error: ${error.message}`;
    }

    res.json({
        status: missing.length === 0 ? 'healthy' : 'unhealthy',
        dependencies: missing.length === 0 ? 'all found' : `missing: ${missing.join(', ')}`,
        minio: {
            status: minioStatus,
            endpoint: `${MINIO_CONFIG.useSSL ? 'https' : 'http'}://${MINIO_CONFIG.endPoint}:${MINIO_CONFIG.port}`,
            bucket: MINIO_BUCKET
        },
        system: systemInfo,
        timestamp: new Date().toISOString()
    });
});

// Start recording - Main API endpoint with MinIO upload
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
    const tempOutputPath = path.join(TEMP_DIR, `slideshow_${recordingId}.mp4`);
    const minioObjectName = `slideshow_${recordingId}.mp4`;
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
        message: 'Recording started. Video will be uploaded to MinIO. Use GET /recording/:id to check progress.',
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

            // Record slideshow to temp file
            await recordSlideshow(presentUrl, timings, tempOutputPath, recordingId);

            // Check if file was created and has content
            if (!fs.existsSync(tempOutputPath)) {
                throw new Error('Recording file was not created');
            }

            const stats = fs.statSync(tempOutputPath);
            if (stats.size === 0) {
                throw new Error('Recording file is empty');
            }

            // Update status
            activeRecordings.get(recordingId).status = 'uploading_to_minio';
            log('INFO', 'Uploading recording to MinIO...', recordingId);

            // Upload to MinIO
            const minioUrl = await uploadToMinIO(tempOutputPath, minioObjectName, recordingId);

            // Update final status
            activeRecordings.set(recordingId, {
                ...activeRecordings.get(recordingId),
                status: 'completed',
                endTime: new Date(),
                fileSize: stats.size,
                fileSizeMB: Math.round(stats.size / 1024 / 1024 * 100) / 100,
                downloadUrl: minioUrl,
                minioObjectName: minioObjectName
            });

            log('SUCCESS', `Recording completed and uploaded: ${minioUrl}`, recordingId);

            // Cleanup temp file
            try {
                fs.unlinkSync(tempOutputPath);
                log('INFO', 'Cleaned up temporary file', recordingId);
            } catch (cleanupError) {
                log('WARNING', `Failed to cleanup temp file: ${cleanupError.message}`, recordingId);
            }

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

            // Cleanup temp file
            if (fs.existsSync(tempOutputPath)) {
                try {
                    fs.unlinkSync(tempOutputPath);
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

    // If not active, return not found (since we don't store locally anymore)
    res.status(404).json({ 
        error: 'Recording not found or expired',
        message: 'Active recordings are only tracked during processing. Use GET /recordings to list completed recordings.'
    });
});

// List all recordings from MinIO
app.get('/recordings', async (req, res) => {
    try {
        const minioRecordings = await listMinIORecordings();
        const activeRecordingsArray = Array.from(activeRecordings.entries()).map(([id, data]) => ({
            recordingId: id,
            ...data
        }));

        res.json({
            recordings: minioRecordings,
            active: activeRecordingsArray,
            count: minioRecordings.length,
            totalSizeMB: Math.round(minioRecordings.reduce((sum, f) => sum + f.fileSizeMB, 0) * 100) / 100,
            storage: 'MinIO'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete recording from MinIO
app.delete('/recording/:id', async (req, res) => {
    const { id } = req.params;
    const objectName = `slideshow_${id}.mp4`;

    try {
        const success = await deleteFromMinIO(objectName);
        if (success) {
            res.json({ success: true, message: 'Recording deleted from MinIO' });
        } else {
            res.status(404).json({ error: 'Recording not found in MinIO' });
        }
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
        name: 'Google Slides Recording API with MinIO',
        version: '2.1.0',
        description: 'Automated recording of Google Slides presentations with MinIO cloud storage',
        endpoints: {
            'GET /': 'API documentation',
            'GET /health': 'Check API health, dependencies, and MinIO connection',
            'POST /record': 'Start recording (body: {slideUrl, timings})',
            'GET /recording/:id': 'Get active recording status',
            'GET /recordings': 'List all recordings from MinIO',
            'DELETE /recording/:id': 'Delete recording from MinIO'
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
                description: 'Check active recording progress'
            }
        },
        storage: {
            type: 'MinIO S3-compatible',
            endpoint: `${MINIO_CONFIG.useSSL ? 'https' : 'http'}://${MINIO_CONFIG.endPoint}:${MINIO_CONFIG.port}`,
            bucket: MINIO_BUCKET,
            publicAccess: true
        },
        requirements: {
            system: ['Linux with X11', 'Xvfb', 'Google Chrome/Chromium', 'FFmpeg', 'Node.js'],
            optional: ['Fluxbox or Openbox window manager for better rendering'],
            minio: ['MinIO server running', 'Valid access credentials']
        },
        environment: {
            MINIO_ENDPOINT: MINIO_CONFIG.endPoint,
            MINIO_PORT: MINIO_CONFIG.port,
            MINIO_USE_SSL: MINIO_CONFIG.useSSL,
            MINIO_BUCKET: MINIO_BUCKET
        }
    });
});

// Initialize MinIO and start server
(async () => {
    const minioReady = await initializeMinIO();
    if (!minioReady) {
        log('ERROR', 'Failed to initialize MinIO. Please check your MinIO configuration.');
        log('INFO', 'Current MinIO config:', JSON.stringify(MINIO_CONFIG, null, 2));
        process.exit(1);
    }

    app.listen(PORT, () => {
        log('INFO', `Google Slides Recording API with MinIO running on port ${PORT}`);
        log('INFO', `Health check: http://localhost:${PORT}/health`);
        log('INFO', `API Documentation: http://localhost:${PORT}/`);
        log('INFO', `MinIO Storage: ${MINIO_CONFIG.useSSL ? 'https' : 'http'}://${MINIO_CONFIG.endPoint}:${MINIO_CONFIG.port}/${MINIO_BUCKET}`);

        // Initial dependency check
        const missing = checkDependencies();
        if (missing.length > 0) {
            log('WARNING', `Missing dependencies: ${missing.join(', ')}`);
            log('WARNING', 'Install with: sudo apt install xvfb google-chrome-stable ffmpeg nodejs npm fluxbox');
        } else {
            log('SUCCESS', 'All dependencies found');
        }
    });
})();