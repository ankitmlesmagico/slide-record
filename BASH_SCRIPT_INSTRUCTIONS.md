# Google Slides Virtual Recording - Bash Script

## Overview
This bash script (`record-slides.sh`) provides a **standalone terminal-based solution** for recording Google Slides presentations using virtual display technology. No web server or browser windows needed!

## Features
- ✅ **Pure Terminal Interface** - No web UI required
- ✅ **Virtual Display** - Uses Xvfb (invisible recording)
- ✅ **Interactive Prompts** - Asks for URL and timings
- ✅ **Automatic Setup** - Handles all dependencies and cleanup
- ✅ **Clean Output** - Professional MP4 recordings
- ✅ **Error Handling** - Comprehensive error checking

## Prerequisites

### Install System Dependencies
```bash
sudo apt update
sudo apt install xvfb google-chrome-stable ffmpeg nodejs npm
```

### Install Node.js Dependencies (if not already done)
```bash
npm install puppeteer
```

## Usage

### 1. Make Script Executable (already done)
```bash
chmod +x record-slides.sh
```

### 2. Run the Script
```bash
./record-slides.sh
```

### 3. Follow Interactive Prompts

**Example Session:**
```
==================================================
  Google Slides Virtual Recording Script
==================================================

[INFO] Checking dependencies...
[SUCCESS] All dependencies found
[INFO] Setting up directories...
[SUCCESS] Directories ready

Enter Google Slides URL: https://docs.google.com/presentation/d/1n4kHRHq0z3awsod4Vs_utIKRpBG8flJK/edit
Enter slide timings (comma-separated seconds, e.g., 5,8,12,20): 3,6,8,10

[INFO] Configuration:
  URL: https://docs.google.com/presentation/d/1n4kHRHq0z3awsod4Vs_utIKRpBG8flJK/edit
  Timings: 3,6,8,10
  Output: recordings/slideshow_20241220_143052.mp4

Press Enter to start recording or Ctrl+C to cancel...

[INFO] Starting virtual display...
[SUCCESS] Virtual display started (PID: 12345)
[INFO] Starting recording process...
Launching Chrome on virtual display...
Loading presentation...
Starting recording...
Advanced to slide 2 at 3s
Advanced to slide 3 at 6s
Advanced to slide 4 at 8s
Advanced to slide 5 at 10s
Stopping recording...
[SUCCESS] Recording completed successfully!
[SUCCESS] Video saved: recordings/slideshow_20241220_143052.mp4
```

## How It Works

### 1. **Dependency Check**
- Verifies Xvfb, Chrome, FFmpeg, Node.js are installed
- Auto-installs Puppeteer if missing

### 2. **Virtual Display Setup**
- Starts Xvfb on display `:99`
- Creates invisible 1440x810 screen
- Enables GPU acceleration for animations

### 3. **Chrome Automation**
- Launches Chrome on virtual display
- Removes automation banners
- Loads presentation in fullscreen

### 4. **Recording Process**
- FFmpeg captures virtual display
- Puppeteer controls slide timing
- Records at 30 FPS with H.264 encoding

### 5. **Automatic Cleanup**
- Stops recording process
- Closes browser
- Terminates virtual display
- Removes temporary files

## Output

### File Location
- **Directory**: `recordings/`
- **Naming**: `slideshow_YYYYMMDD_HHMMSS.mp4`
- **Format**: MP4 with H.264 encoding

### Video Quality
- **Resolution**: 1440x810 (matches virtual display)
- **Frame Rate**: 30 FPS
- **Quality**: CRF 23 (high quality)
- **Codec**: H.264 with fast preset

## Advanced Usage

### Custom Resolution
Edit the script and change:
```bash
RESOLUTION="1920x1080"  # Change this line
```

### Different Display Number
```bash
DISPLAY_NUM=":100"      # Change this line
```

### Custom Output Directory
```bash
RECORDINGS_DIR="my_recordings"  # Change this line
```

## Troubleshooting

### Common Issues

1. **"Xvfb command not found"**
   ```bash
   sudo apt install xvfb
   ```

2. **"Chrome not found"**
   ```bash
   sudo apt install google-chrome-stable
   ```

3. **"Puppeteer not found"**
   ```bash
   npm install puppeteer
   ```

4. **Permission errors**
   ```bash
   chmod +x record-slides.sh
   ```

5. **Display already in use**
   - Script automatically kills existing Xvfb processes
   - Or change `DISPLAY_NUM` in script

### Debug Mode
Add debug output by editing the script:
```bash
set -x  # Add this line after #!/bin/bash
```

## Comparison with Web Version

| Feature | Bash Script | Web Server |
|---------|-------------|------------|
| **Interface** | Terminal prompts | Web browser |
| **Setup** | Single script | Server + frontend |
| **Dependencies** | System packages | Node.js server |
| **Portability** | Standalone | Requires web server |
| **Automation** | Command-line friendly | API-based |
| **Resource Usage** | Lower | Higher (web server) |

## Integration Examples

### Batch Processing
```bash
#!/bin/bash
urls=(
    "https://docs.google.com/presentation/d/url1/edit"
    "https://docs.google.com/presentation/d/url2/edit"
)
timings="5,8,12,15"

for url in "${urls[@]}"; do
    echo -e "$url\n$timings" | ./record-slides.sh
done
```

### Cron Job
```bash
# Add to crontab for scheduled recording
0 9 * * 1 cd /path/to/puppetier && echo -e "URL\n5,8,12" | ./record-slides.sh
```

## Benefits

1. **Simplicity** - Single command execution
2. **Portability** - Works on any Linux system
3. **Automation** - Perfect for scripts and cron jobs
4. **Resource Efficient** - No web server overhead
5. **Clean Output** - Professional quality recordings
6. **Invisible Operation** - No desktop interference

This bash script provides the same functionality as the web version but in a more streamlined, terminal-friendly format perfect for automation and server environments.