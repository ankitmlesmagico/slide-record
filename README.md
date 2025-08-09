# Google Slides Recorder

Automatically record Google Slides presentations with custom timing using Puppeteer and ffmpeg.

## Features

- Input Google Slides URL and custom slide timings
- Automated presentation playback in fullscreen mode
- Screen recording with ffmpeg (window-specific, no cursor)
- Preserves animations, transitions, and GIFs
- Download recorded MP4 video

## Prerequisites

### System Requirements

1. **Node.js** (v16 or higher)
2. **ffmpeg** - For screen recording

### Install Dependencies

#### macOS
```bash
# Install ffmpeg using Homebrew
brew install ffmpeg

# Install Node.js dependencies
npm install
```

#### Linux/Kali
```bash
# Install ffmpeg
sudo apt update
sudo apt install ffmpeg x11-utils

# Install Node.js dependencies
npm install
```

## Setup

1. Clone or download this project
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the server:
   ```bash
   npm start
   ```
4. Open browser and go to: `http://localhost:3000`

## Usage

1. **Get Google Slides URL**: Copy the URL of your Google Slides presentation (edit or present mode)

2. **Set Slide Timings**: Enter comma-separated seconds when slides should advance
   - Example: `5,8,12,20` means:
     - Advance to slide 2 after 5 seconds
     - Advance to slide 3 after 8 seconds
     - Advance to slide 4 after 12 seconds
     - Advance to slide 5 after 20 seconds

3. **Start Recording**: Click "Start Recording" button

4. **Automated Process**:
   - Chrome opens in fullscreen mode
   - Presentation loads automatically
   - Recording starts
   - Slides advance at specified times
   - Recording stops after last slide + 5 seconds

5. **Download**: Click download link when recording completes

## Technical Details

### Browser Automation
- Uses Puppeteer to control Chrome
- Launches in fullscreen mode for clean recording
- Automatically converts edit URLs to presentation mode
- Simulates keyboard presses (Right Arrow) for slide advancement

### Screen Recording
- **macOS**: Uses ffmpeg with avfoundation for screen capture
- **Linux**: Uses ffmpeg with x11grab for screen capture
- Detects screen resolution automatically
- Records at 30 FPS with H.264 encoding
- Full screen recording (macOS) or window-specific (Linux)

### File Structure
```
├── server.js          # Main Express server
├── package.json       # Dependencies
├── public/
│   ├── index.html     # Frontend interface
│   ├── style.css      # Styling
│   └── script.js      # Frontend logic
├── recordings/        # Output videos (auto-created)
└── README.md         # This file
```

## Troubleshooting

### Common Issues

1. **Chrome not opening in fullscreen**:
   - Ensure no other Chrome instances are running
   - Try: `pkill chrome` before starting

2. **Recording shows black screen**:
   - Verify ffmpeg and x11-utils are installed
   - Check if xwininfo can detect Chrome window

3. **Slides not advancing**:
   - Ensure Google Slides URL is accessible
   - Check if presentation has the expected number of slides
   - Verify timing array format (comma-separated numbers)

4. **Permission errors**:
   - Ensure recordings directory is writable
   - Run with appropriate permissions

### Debug Mode

For detailed logging, check the server console output when recording starts.

## Limitations

- **macOS**: Records entire screen (may include other applications)
- **Linux**: Window-specific recording (cleaner output)
- Requires GUI environment (not headless server)
- Google Slides must be publicly accessible or user must be logged in
- Recording quality depends on system performance
- **macOS**: May require screen recording permissions in System Preferences

## License

MIT License - Feel free to modify and distribute.# slide-record
