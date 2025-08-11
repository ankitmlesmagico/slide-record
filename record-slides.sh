#!/bin/bash

# Google Slides Virtual Recording Script
# This script records Google Slides presentations using virtual display (no visible browser)

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
DISPLAY_NUM=":99"
RESOLUTION="1440x810"
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
    
    if [ ${#missing_deps[@]} -ne 0 ]; then
        print_error "Missing dependencies: ${missing_deps[*]}"
        echo "Install with: sudo apt install xvfb google-chrome-stable ffmpeg nodejs npm"
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

# Function to start Xvfb
start_xvfb() {
    print_status "Starting virtual display..."
    
    # Kill any existing Xvfb on this display
    pkill -f "Xvfb $DISPLAY_NUM" 2>/dev/null || true
    
    # Start Xvfb in background
    Xvfb $DISPLAY_NUM -screen 0 ${RESOLUTION}x24 -ac +extension GLX +render -noreset &
    XVFB_PID=$!
    
    # Wait for Xvfb to start
    sleep 2
    
    if kill -0 $XVFB_PID 2>/dev/null; then
        print_success "Virtual display started (PID: $XVFB_PID)"
    else
        print_error "Failed to start virtual display"
        exit 1
    fi
}

# Function to stop Xvfb
stop_xvfb() {
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

# Function to record slideshow
record_slideshow() {
    local slide_url="$1"
    local timings="$2"
    local output_file="$3"
    
    # Convert URL to presentation mode
    local present_url=$(convert_to_present_url "$slide_url")
    print_status "Presentation URL: $present_url"
    
    # Get Chrome executable
    local chrome_exec=$(get_chrome_executable)
    
    # Create Node.js script for automation
    cat > temp_record.js << 'EOF'
const puppeteer = require('puppeteer');
const { spawn } = require('child_process');

async function recordSlideshow(slideUrl, timings, outputPath) {
    let browser;
    let ffmpegProcess;
    
    try {
        console.log('Launching Chrome on virtual display...');
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
                '--enable-gpu',
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-web-security',
                '--disable-infobars',
                '--no-first-run',
                '--disable-extensions'
            ]
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 1440, height: 810 });
        
        // Remove automation detection
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        });
        
        console.log('Loading presentation...');
        await page.goto(slideUrl, { waitUntil: 'networkidle2' });
        await page.waitForTimeout(3000);
        
        // Start recording
        console.log('Starting recording...');
        const ffmpegArgs = [
            '-f', 'x11grab',
            '-r', '30',
            '-s', process.env.RESOLUTION,
            '-i', `${process.env.DISPLAY_NUM}.0+0,0`,
            '-c:v', 'libx264',
            '-preset', 'fast',
            '-crf', '23',
            '-pix_fmt', 'yuv420p',
            '-y',
            outputPath
        ];
        
        ffmpegProcess = spawn('ffmpeg', ffmpegArgs);
        ffmpegProcess.stderr.on('data', (data) => {
            console.log('FFmpeg:', data.toString().trim());
        });
        
        await page.waitForTimeout(2000);
        
        // Execute slide transitions
        let currentTime = 0;
        for (let i = 0; i < timings.length; i++) {
            const waitTime = (timings[i] - currentTime) * 1000;
            if (waitTime > 0) {
                await page.waitForTimeout(waitTime);
            }
            
            await page.keyboard.press('ArrowRight');
            console.log(`Advanced to slide ${i + 2} at ${timings[i]}s`);
            currentTime = timings[i];
        }
        
        await page.waitForTimeout(5000);
        
    } finally {
        if (ffmpegProcess) {
            console.log('Stopping recording...');
            ffmpegProcess.kill('SIGTERM');
            await new Promise(resolve => {
                ffmpegProcess.on('close', resolve);
                setTimeout(resolve, 3000);
            });
        }
        
        if (browser) {
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
    .then(() => console.log('Recording completed successfully!'))
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

# Main function
main() {
    echo "=================================================="
    echo "  Google Slides Virtual Recording Script"
    echo "=================================================="
    echo
    
    # Check if puppeteer is installed
    if [ ! -d "node_modules/puppeteer" ]; then
        print_warning "Puppeteer not found. Installing..."
        npm install puppeteer
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
    echo
    
    read -p "Press Enter to start recording or Ctrl+C to cancel..."
    
    start_xvfb
    
    print_status "Starting recording process..."
    record_slideshow "$SLIDE_URL" "$TIMINGS" "$OUTPUT_FILE"
    
    if [ -f "$OUTPUT_FILE" ]; then
        print_success "Recording completed successfully!"
        print_success "Video saved: $OUTPUT_FILE"
        
        # Show file info
        if command -v ffprobe &> /dev/null; then
            echo
            print_status "Video information:"
            ffprobe -v quiet -show_format -show_streams "$OUTPUT_FILE" | grep -E "(duration|width|height|codec_name)" | head -5
        fi
    else
        print_error "Recording failed - output file not found"
        exit 1
    fi
}

# Run main function
main "$@"