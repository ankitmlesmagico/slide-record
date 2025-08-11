#!/bin/bash

# Google Slides Virtual Recording Script - Fixed Version
# This script records Google Slides presentations using virtual display with proper rendering

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration - Updated for better compatibility
DISPLAY_NUM=":99"
RESOLUTION="1920x1080"  # Changed to standard resolution
RECORDINGS_DIR="recordings"
CHROME_PROFILE_DIR="chrome-profile-virtual"

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Function to check dependencies
check_dependencies() {
    print_status "Checking dependencies..."
    
    local missing_deps=()
    
    if ! command -v xvfb-run &> /dev/null; then
        missing_deps+=("xvfb")
    fi
    
    if ! command -v google-chrome &> /dev/null && ! command -v chromium-browser &> /dev/null; then
        missing_deps+=("google-chrome or chromium-browser")
    fi
    
    if ! command -v ffmpeg &> /dev/null; then
        missing_deps+=("ffmpeg")
    fi
    
    if ! command -v node &> /dev/null; then
        missing_deps+=("nodejs")
    fi
    
    # Check for window manager (recommended for virtual display)
    if ! command -v fluxbox &> /dev/null && ! command -v openbox &> /dev/null; then
        print_warning "No lightweight window manager found. Consider installing fluxbox or openbox for better rendering."
    fi
    
    if [ ${#missing_deps[@]} -ne 0 ]; then
        print_error "Missing dependencies: ${missing_deps[*]}"
        echo "Install with: sudo apt install xvfb google-chrome-stable ffmpeg nodejs npm fluxbox"
        exit 1
    fi
    
    print_success "All dependencies found"
}

# Function to setup directories
setup_directories() {
    print_status "Setting up directories..."
    mkdir -p "$RECORDINGS_DIR"
    mkdir -p "$CHROME_PROFILE_DIR"
    print_success "Directories ready"
}

# Function to start Xvfb with improved settings
start_xvfb() {
    print_status "Starting virtual display with enhanced settings..."
    
    # Kill any existing Xvfb on this display
    pkill -f "Xvfb $DISPLAY_NUM" 2>/dev/null || true
    sleep 1
    
    # Start Xvfb with better parameters for rendering
    Xvfb $DISPLAY_NUM \
        -screen 0 ${RESOLUTION}x24 \
        -ac \
        +extension GLX \
        +extension RANDR \
        +extension RENDER \
        -noreset \
        -dpi 96 \
        -fbdir /tmp &
    
    XVFB_PID=$!
    
    # Wait for Xvfb to start properly
    sleep 3
    
    if kill -0 $XVFB_PID 2>/dev/null; then
        print_success "Virtual display started (PID: $XVFB_PID)"
        
        # Start a lightweight window manager if available
        export DISPLAY=$DISPLAY_NUM
        if command -v fluxbox &> /dev/null; then
            fluxbox &
            WM_PID=$!
            print_status "Started Fluxbox window manager"
        elif command -v openbox &> /dev/null; then
            openbox &
            WM_PID=$!
            print_status "Started Openbox window manager"
        fi
        
        sleep 2
    else
        print_error "Failed to start virtual display"
        exit 1
    fi
}

# Function to stop Xvfb and window manager
stop_xvfb() {
    if [ ! -z "$WM_PID" ]; then
        print_status "Stopping window manager..."
        kill $WM_PID 2>/dev/null || true
    fi
    
    if [ ! -z "$XVFB_PID" ]; then
        print_status "Stopping virtual display..."
        kill $XVFB_PID 2>/dev/null || true
        wait $XVFB_PID 2>/dev/null || true
        print_success "Virtual display stopped"
    fi
}

# Function to get Chrome executable
get_chrome_executable() {
    if command -v google-chrome &> /dev/null; then
        echo "google-chrome"
    elif command -v chromium-browser &> /dev/null; then
        echo "chromium-browser"
    else
        print_error "No Chrome/Chromium found"
        exit 1
    fi
}

# Function to convert URL to presentation mode
convert_to_present_url() {
    local url="$1"
    if [[ "$url" == *"/present"* ]]; then
        echo "$url"
    else
        echo "$url" | sed 's|/edit|/present|g' | sed 's|#|/present#|g'
    fi
}

# Function to record slideshow with improved settings
record_slideshow() {
    local slide_url="$1"
    local timings="$2"
    local output_file="$3"
    
    # Convert URL to presentation mode
    local present_url=$(convert_to_present_url "$slide_url")
    print_status "Presentation URL: $present_url"
    
    # Get Chrome executable
    local chrome_exec=$(get_chrome_executable)
    
    # Create Node.js script for automation with improved settings
    cat > temp_record.js << 'EOF'
const puppeteer = require('puppeteer');
const { spawn } = require('child_process');

async function recordSlideshow(slideUrl, timings, outputPath) {
    let browser;
    let ffmpegProcess;
    
    try {
        console.log('Launching Chrome on virtual display with improved settings...');
        
        browser = await puppeteer.launch({
            headless: false,
            executablePath: process.env.CHROME_EXEC,
            env: { 
                ...process.env,
                DISPLAY: process.env.DISPLAY_NUM 
            },
            ignoreDefaultArgs: [
                '--enable-automation',
                '--enable-blink-features=AutomationControlled'
            ],
            args: [
                '--start-fullscreen',
                '--kiosk',  // Added for full kiosk mode
                '--enable-gpu',
                '--use-gl=swiftshader',  // Software rendering fallback
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
                '--force-device-scale-factor=1',  // Ensure consistent scaling
                '--high-dpi-support=1',
                '--force-color-profile=srgb',
                `--window-size=1920,1080`,
                `--window-position=0,0`,
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
        
        // Set viewport to match virtual display
        await page.setViewport({ 
            width: 1920, 
            height: 1080,
            deviceScaleFactor: 1
        });
        
        // Enhanced automation detection removal
        await page.evaluateOnNewDocument(() => {
            // Remove webdriver property
            Object.defineProperty(navigator, 'webdriver', { 
                get: () => undefined 
            });
            
            // Override the plugins property
            Object.defineProperty(navigator, 'plugins', {
                get: () => [1, 2, 3, 4, 5]
            });
            
            // Override the languages property
            Object.defineProperty(navigator, 'languages', {
                get: () => ['en-US', 'en']
            });
            
            // Override chrome property
            window.chrome = {
                runtime: {}
            };
            
            // Override permissions
            Object.defineProperty(navigator, 'permissions', {
                get: () => ({
                    query: () => Promise.resolve({ state: 'granted' })
                })
            });
        });
        
        console.log('Loading presentation...');
        
        // Try multiple loading strategies
        try {
            await page.goto(slideUrl, { 
                waitUntil: 'domcontentloaded',
                timeout: 60000
            });
            console.log('Page loaded with domcontentloaded');
        } catch (firstError) {
            console.log('First attempt failed, trying with networkidle2...');
            try {
                await page.goto(slideUrl, { 
                    waitUntil: 'networkidle2',
                    timeout: 45000
                });
                console.log('Page loaded with networkidle2');
            } catch (secondError) {
                console.log('Second attempt failed, trying basic load...');
                await page.goto(slideUrl, { 
                    waitUntil: 'load',
                    timeout: 30000
                });
                console.log('Page loaded with basic load');
            }
        }
        
        // Wait for Google Slides to fully load and check for common elements
        console.log('Waiting for Google Slides interface to load...');
        await page.waitForTimeout(8000);  // Increased wait time
        
        // Check if we're on the correct page and logged in
        try {
            // Wait for any of these elements that might indicate the page loaded
            await Promise.race([
                page.waitForSelector('iframe', { timeout: 10000 }),
                page.waitForSelector('[data-testid="present-button"]', { timeout: 10000 }),
                page.waitForSelector('.punch-present-btn', { timeout: 10000 }),
                page.waitForSelector('[aria-label*="Present"]', { timeout: 10000 }),
                page.waitForTimeout(10000) // Fallback timeout
            ]);
            console.log('Google Slides elements detected');
        } catch (e) {
            console.log('Could not detect specific Google Slides elements, continuing...');
        }
        
        // Check if there's a login requirement
        const currentUrl = page.url();
        if (currentUrl.includes('accounts.google.com') || currentUrl.includes('signin')) {
            throw new Error('Authentication required. Please ensure the presentation is publicly accessible or you are logged in.');
        }
        
        // Try to dismiss any popups or notifications
        try {
            await page.keyboard.press('Escape');
            await page.waitForTimeout(1000);
        } catch (e) {
            // Ignore popup dismissal errors
        }
        
        // Ensure we're in fullscreen presentation mode
        try {
            await page.keyboard.press('F5');
            await page.waitForTimeout(2000);
        } catch (e) {
            console.log('F5 key press failed, continuing...');
        }
        
        console.log('Starting screen recording...');
        
        // Enhanced FFmpeg settings for better quality and compatibility
        const ffmpegArgs = [
            '-f', 'x11grab',
            '-video_size', process.env.RESOLUTION,
            '-framerate', '30',
            '-i', `${process.env.DISPLAY_NUM}.0+0,0`,
            '-c:v', 'libx264',
            '-preset', 'medium',  // Better quality than 'fast'
            '-crf', '20',         // Higher quality
            '-pix_fmt', 'yuv420p',
            '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',  // Ensure even dimensions
            '-movflags', '+faststart',
            '-y',
            outputPath
        ];
        
        ffmpegProcess = spawn('ffmpeg', ffmpegArgs, {
            stdio: ['ignore', 'ignore', 'pipe']
        });
        
        ffmpegProcess.stderr.on('data', (data) => {
            const output = data.toString().trim();
            if (output.includes('frame=') || output.includes('time=')) {
                // Only log important FFmpeg output
                console.log('Recording:', output.split(' ').pop());
            }
        });
        
        // Wait for recording to start
        await page.waitForTimeout(3000);
        
        // Execute slide transitions with better timing
        let currentTime = 0;
        console.log('Starting slide transitions...');
        
        for (let i = 0; i < timings.length; i++) {
            const waitTime = (timings[i] - currentTime) * 1000;
            if (waitTime > 0) {
                console.log(`Waiting ${waitTime/1000}s before advancing to slide ${i + 2}...`);
                await page.waitForTimeout(waitTime);
            }
            
            // Use multiple methods to advance slides
            await page.keyboard.press('ArrowRight');
            await page.waitForTimeout(100);
            
            console.log(`Advanced to slide ${i + 2} at ${timings[i]}s`);
            currentTime = timings[i];
        }
        
        // Wait for final slide to be recorded
        console.log('Recording final slide...');
        await page.waitForTimeout(5000);
        
    } catch (error) {
        console.error('Error during recording:', error);
        throw error;
    } finally {
        if (ffmpegProcess && !ffmpegProcess.killed) {
            console.log('Stopping screen recording...');
            ffmpegProcess.kill('SIGTERM');
            
            // Wait for FFmpeg to finish processing
            await new Promise(resolve => {
                const timeout = setTimeout(resolve, 5000);
                ffmpegProcess.on('close', () => {
                    clearTimeout(timeout);
                    resolve();
                });
            });
        }
        
        if (browser) {
            console.log('Closing browser...');
            await browser.close();
        }
    }
}

// Parse command line arguments
const slideUrl = process.argv[2];
const timingsStr = process.argv[3];
const outputPath = process.argv[4];

const timings = timingsStr.split(',').map(t => parseFloat(t.trim()));

recordSlideshow(slideUrl, timings, outputPath)
    .then(() => {
        console.log('Recording completed successfully!');
        process.exit(0);
    })
    .catch(err => {
        console.error('Recording failed:', err);
        process.exit(1);
    });
EOF

    # Set environment variables and run Node.js script
    DISPLAY_NUM="$DISPLAY_NUM" \
    RESOLUTION="$RESOLUTION" \
    CHROME_EXEC="$chrome_exec" \
    node temp_record.js "$present_url" "$timings" "$output_file"
    
    # Cleanup temp script
    rm -f temp_record.js
}

# Function to cleanup on exit
cleanup() {
    print_status "Cleaning up..."
    stop_xvfb
    rm -f temp_record.js
    exit
}

# Set trap for cleanup
trap cleanup EXIT INT TERM

# Function to test virtual display
test_virtual_display() {
    print_status "Testing virtual display setup..."
    
    export DISPLAY=$DISPLAY_NUM
    
    # Test if we can create a simple window
    if command -v xwininfo &> /dev/null; then
        if xwininfo -root >/dev/null 2>&1; then
            print_success "Virtual display is working correctly"
            return 0
        fi
    fi
    
    print_error "Virtual display test failed"
    return 1
}

# Main function
main() {
    echo "=================================================="
    echo "  Google Slides Virtual Recording Script (Fixed)"
    echo "=================================================="
    echo
    
    # Check if puppeteer is installed
    if [ ! -d "node_modules/puppeteer" ]; then
        print_warning "Puppeteer not found. Installing..."
        npm install puppeteer
        if [ $? -ne 0 ]; then
            print_error "Failed to install Puppeteer"
            exit 1
        fi
    fi
    
    check_dependencies
    setup_directories
    
    # Get user input
    echo
    read -p "Enter Google Slides URL: " SLIDE_URL
    
    if [ -z "$SLIDE_URL" ]; then
        print_error "URL cannot be empty"
        exit 1
    fi
    
    read -p "Enter slide timings (comma-separated seconds, e.g., 5,8,12,20): " TIMINGS
    
    if [ -z "$TIMINGS" ]; then
        print_error "Timings cannot be empty"
        exit 1
    fi
    
    # Generate output filename
    TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
    OUTPUT_FILE="$RECORDINGS_DIR/slideshow_$TIMESTAMP.mp4"
    
    echo
    print_status "Configuration:"
    echo "  URL: $SLIDE_URL"
    echo "  Timings: $TIMINGS"
    echo "  Output: $OUTPUT_FILE"
    echo "  Resolution: $RESOLUTION"
    echo
    
    read -p "Press Enter to start recording or Ctrl+C to cancel..."
    
    start_xvfb
    
    # Test virtual display before recording
    if ! test_virtual_display; then
        print_error "Virtual display test failed. Attempting to continue..."
    fi
    
    print_status "Starting recording process..."
    if record_slideshow "$SLIDE_URL" "$TIMINGS" "$OUTPUT_FILE"; then
        if [ -f "$OUTPUT_FILE" ]; then
            print_success "Recording completed successfully!"
            print_success "Video saved: $OUTPUT_FILE"
            
            # Show file info
            if command -v ffprobe &> /dev/null; then
                echo
                print_status "Video information:"
                ffprobe -v quiet -show_format -show_streams "$OUTPUT_FILE" 2>/dev/null | grep -E "(duration|width|height|codec_name)" | head -5
            fi
            
            # Check file size
            file_size=$(stat -f%z "$OUTPUT_FILE" 2>/dev/null || stat -c%s "$OUTPUT_FILE" 2>/dev/null || echo "unknown")
            if [ "$file_size" != "unknown" ]; then
                print_status "File size: $(echo "scale=2; $file_size / 1024 / 1024" | bc 2>/dev/null || echo "N/A") MB"
            fi
        else
            print_error "Recording failed - output file not found"
            exit 1
        fi
    else
        print_error "Recording process failed"
        exit 1
    fi
}

# Run main function
main "$@"