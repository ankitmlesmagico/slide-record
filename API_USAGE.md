# Google Slides Recording API Usage Guide

## Overview

This API allows you to automatically record Google Slides presentations by providing a presentation URL and timing array for slide transitions.

## Quick Start

### 1. Install Dependencies

```bash
# Install system dependencies (Ubuntu/Debian)
sudo apt update
sudo apt install -y xvfb google-chrome-stable ffmpeg nodejs npm fluxbox

# Install Node.js dependencies
npm install
```

### 2. Start the API Server

```bash
node slides-recording-api.js
```

The server will start on port 3003 by default.

### 3. Check Health

```bash
curl http://localhost:3003/health
```

## API Endpoints

### POST /record

Start a new recording.

**Request Body:**
```json
{
  "slideUrl": "https://docs.google.com/presentation/d/your-presentation-id/edit",
  "timings": [5, 8, 12, 20]
}
```

**Response:**
```json
{
  "success": true,
  "recordingId": "uuid-here",
  "status": "started",
  "message": "Recording started. Use GET /recording/:id to check progress.",
  "estimatedDuration": 30,
  "timestamp": "2024-12-08T10:30:00.000Z"
}
```

### GET /recording/:id

Check recording status or get completed recording info.

**Response (In Progress):**
```json
{
  "recordingId": "uuid-here",
  "status": "recording",
  "slideUrl": "https://docs.google.com/presentation/d/your-id/present",
  "timings": [5, 8, 12, 20],
  "startTime": "2024-12-08T10:30:00.000Z",
  "lastUpdate": "2024-12-08T10:30:15.000Z",
  "duration": 15000
}
```

**Response (Completed):**
```json
{
  "recordingId": "uuid-here",
  "status": "completed",
  "fileSize": 15728640,
  "fileSizeMB": 15.0,
  "downloadUrl": "/recordings/slideshow_uuid-here.mp4",
  "endTime": "2024-12-08T10:31:00.000Z"
}
```

### GET /recordings

List all recordings.

**Response:**
```json
{
  "recordings": [
    {
      "recordingId": "uuid-here",
      "filename": "slideshow_uuid-here.mp4",
      "fileSize": 15728640,
      "fileSizeMB": 15.0,
      "created": "2024-12-08T10:30:00.000Z",
      "downloadUrl": "/recordings/slideshow_uuid-here.mp4"
    }
  ],
  "active": [],
  "count": 1,
  "totalSizeMB": 15.0
}
```

### DELETE /recording/:id

Delete a recording file.

**Response:**
```json
{
  "success": true,
  "message": "Recording deleted"
}
```

## Usage Examples

### JavaScript/Node.js

```javascript
const axios = require('axios');

async function recordSlides() {
    const API_BASE = 'http://localhost:3003';
    
    // Start recording
    const response = await axios.post(`${API_BASE}/record`, {
        slideUrl: 'https://docs.google.com/presentation/d/your-id/edit',
        timings: [5, 8, 12, 20] // Advance slides at these seconds
    });
    
    const recordingId = response.data.recordingId;
    console.log('Recording started:', recordingId);
    
    // Check status periodically
    const checkStatus = async () => {
        const status = await axios.get(`${API_BASE}/recording/${recordingId}`);
        console.log('Status:', status.data.status);
        
        if (status.data.status === 'completed') {
            console.log('Download URL:', `${API_BASE}${status.data.downloadUrl}`);
        } else if (status.data.status === 'failed') {
            console.log('Error:', status.data.error);
        } else {
            setTimeout(checkStatus, 5000); // Check again in 5 seconds
        }
    };
    
    checkStatus();
}

recordSlides();
```

### Python

```python
import requests
import time

API_BASE = 'http://localhost:3003'

def record_slides():
    # Start recording
    response = requests.post(f'{API_BASE}/record', json={
        'slideUrl': 'https://docs.google.com/presentation/d/your-id/edit',
        'timings': [5, 8, 12, 20]
    })
    
    recording_id = response.json()['recordingId']
    print(f'Recording started: {recording_id}')
    
    # Check status
    while True:
        status_response = requests.get(f'{API_BASE}/recording/{recording_id}')
        status = status_response.json()
        
        print(f'Status: {status["status"]}')
        
        if status['status'] == 'completed':
            print(f'Download URL: {API_BASE}{status["downloadUrl"]}')
            break
        elif status['status'] == 'failed':
            print(f'Error: {status["error"]}')
            break
        
        time.sleep(5)

record_slides()
```

### cURL

```bash
# Start recording
curl -X POST http://localhost:3003/record \
  -H "Content-Type: application/json" \
  -d '{
    "slideUrl": "https://docs.google.com/presentation/d/your-id/edit",
    "timings": [5, 8, 12, 20]
  }'

# Check status (replace uuid-here with actual recording ID)
curl http://localhost:3003/recording/uuid-here

# Download file (replace uuid-here with actual recording ID)
curl -O http://localhost:3003/recordings/slideshow_uuid-here.mp4
```

## Important Notes

### Slide URL Requirements

- Must be a Google Slides presentation URL
- Presentation must be publicly accessible or you must be logged in
- The API automatically converts `/edit` URLs to `/present` mode

### Timings Array

- Array of numbers representing seconds when to advance to the next slide
- Must be positive numbers in ascending order
- Example: `[5, 8, 12, 20]` means:
  - Stay on slide 1 for 5 seconds
  - Advance to slide 2, stay for 3 seconds (8-5)
  - Advance to slide 3, stay for 4 seconds (12-8)
  - Advance to slide 4, stay for 8 seconds (20-12)
  - Record final slide for 5 more seconds

### System Requirements

- Linux with X11 support
- Xvfb (virtual display)
- Google Chrome or Chromium
- FFmpeg
- Node.js 16+
- Optional: Fluxbox or Openbox window manager

### Limitations

- Only one recording can run at a time
- Requires public access to Google Slides or pre-authenticated browser
- Recording quality is 1920x1080 at 30fps
- Files are stored locally in the `recordings/` directory

## Troubleshooting

### Common Issues

1. **"Missing dependencies" error**
   ```bash
   sudo apt install xvfb google-chrome-stable ffmpeg nodejs npm fluxbox
   ```

2. **"Authentication required" error**
   - Make sure the Google Slides presentation is publicly accessible
   - Or ensure you're logged into Google in the system browser

3. **"System busy" error**
   - Only one recording can run at a time
   - Wait for current recording to complete or check `/recordings` endpoint

4. **Recording file is empty**
   - Check if the presentation loaded correctly
   - Verify the URL is accessible
   - Check system resources (memory, disk space)

### Testing

Run the included test script:

```bash
node test-api.js
```

This will test the API with a public Google Slides presentation.

## Performance Tips

- Use a lightweight window manager (Fluxbox/Openbox) for better rendering
- Ensure sufficient disk space for video files
- Monitor system resources during recording
- Clean up old recordings periodically using the DELETE endpoint