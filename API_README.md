# Google Slides Recording API

## Overview
REST API wrapper for the Google Slides recording functionality. Converts the bash script into a web service that other applications can consume.

## Quick Start

### 1. Install Dependencies
```bash
# Copy package.json for API
cp package-api.json package.json

# Install Node.js dependencies
npm install

# Ensure system dependencies
sudo apt install xvfb google-chrome-stable ffmpeg fluxbox
```

### 2. Start API Server
```bash
# Start the API server
npm start

# Or with auto-reload for development
npm run dev
```

### 3. Test API
```bash
# Check health
curl http://localhost:3002/health

# Start recording
curl -X POST http://localhost:3002/record \
  -H "Content-Type: application/json" \
  -d '{
    "slideUrl": "https://docs.google.com/presentation/d/your-id/edit",
    "timings": [5, 8, 12, 20]
  }'
```

## API Endpoints

### Health Check
```http
GET /health
```
**Response:**
```json
{
  "status": "healthy",
  "dependencies": "all found",
  "timestamp": "2024-12-20T14:30:52.123Z"
}
```

### Start Recording
```http
POST /record
Content-Type: application/json

{
  "slideUrl": "https://docs.google.com/presentation/d/your-id/edit",
  "timings": [5, 8, 12, 20]
}
```
**Response:**
```json
{
  "success": true,
  "recordingId": "uuid-here",
  "downloadUrl": "/recordings/slideshow_uuid-here.mp4",
  "fileSize": 15728640,
  "fileSizeMB": 15.0,
  "timestamp": "2024-12-20T14:30:52.123Z"
}
```

### Get Recording Info
```http
GET /recording/{recordingId}
```
**Response:**
```json
{
  "recordingId": "uuid-here",
  "exists": true,
  "fileSize": 15728640,
  "fileSizeMB": 15.0,
  "created": "2024-12-20T14:30:52.123Z",
  "downloadUrl": "/recordings/slideshow_uuid-here.mp4"
}
```

### List All Recordings
```http
GET /recordings
```
**Response:**
```json
{
  "recordings": [
    {
      "recordingId": "uuid-1",
      "filename": "slideshow_uuid-1.mp4",
      "fileSize": 15728640,
      "fileSizeMB": 15.0,
      "created": "2024-12-20T14:30:52.123Z",
      "downloadUrl": "/recordings/slideshow_uuid-1.mp4"
    }
  ],
  "count": 1,
  "totalSizeMB": 15.0
}
```

### Download Recording
```http
GET /recordings/slideshow_{recordingId}.mp4
```
Returns the MP4 file for download.

### Delete Recording
```http
DELETE /recording/{recordingId}
```
**Response:**
```json
{
  "success": true,
  "message": "Recording deleted"
}
```

## Usage Examples

### JavaScript/Node.js Client
```javascript
const axios = require('axios');

const API_BASE = 'http://localhost:3002';

// Start recording
async function recordSlides(slideUrl, timings) {
  try {
    const response = await axios.post(`${API_BASE}/record`, {
      slideUrl,
      timings
    });
    
    console.log('Recording started:', response.data);
    return response.data.recordingId;
  } catch (error) {
    console.error('Recording failed:', error.response.data);
  }
}

// Check recording status
async function getRecording(recordingId) {
  try {
    const response = await axios.get(`${API_BASE}/recording/${recordingId}`);
    return response.data;
  } catch (error) {
    console.error('Recording not found:', error.response.data);
  }
}

// Usage
recordSlides(
  'https://docs.google.com/presentation/d/your-id/edit',
  [5, 8, 12, 20]
).then(recordingId => {
  console.log('Recording ID:', recordingId);
});
```

### Python Client
```python
import requests
import json

API_BASE = 'http://localhost:3002'

def record_slides(slide_url, timings):
    response = requests.post(f'{API_BASE}/record', 
        json={
            'slideUrl': slide_url,
            'timings': timings
        }
    )
    
    if response.status_code == 200:
        data = response.json()
        print(f"Recording started: {data['recordingId']}")
        return data['recordingId']
    else:
        print(f"Error: {response.json()}")
        return None

def get_recording(recording_id):
    response = requests.get(f'{API_BASE}/recording/{recording_id}')
    return response.json() if response.status_code == 200 else None

# Usage
recording_id = record_slides(
    'https://docs.google.com/presentation/d/your-id/edit',
    [5, 8, 12, 20]
)

if recording_id:
    info = get_recording(recording_id)
    print(f"Recording info: {info}")
```

### cURL Examples
```bash
# Health check
curl http://localhost:3002/health

# Start recording
curl -X POST http://localhost:3002/record \
  -H "Content-Type: application/json" \
  -d '{
    "slideUrl": "https://docs.google.com/presentation/d/1ABC123/edit",
    "timings": [3, 6, 9, 12]
  }'

# Get recording info
curl http://localhost:3002/recording/uuid-here

# List all recordings
curl http://localhost:3002/recordings

# Download recording
curl -O http://localhost:3002/recordings/slideshow_uuid-here.mp4

# Delete recording
curl -X DELETE http://localhost:3002/recording/uuid-here
```

## Configuration

### Environment Variables
```bash
# Port (default: 3002)
export PORT=3002

# Display number (default: :99)
export DISPLAY_NUM=:99

# Resolution (default: 1920x1080)
export RESOLUTION=1920x1080
```

### Custom Configuration
Edit `api-server.js`:
```javascript
const DISPLAY_NUM = process.env.DISPLAY_NUM || ':99';
const RESOLUTION = process.env.RESOLUTION || '1920x1080';
const RECORDINGS_DIR = process.env.RECORDINGS_DIR || 'recordings';
```

## Docker Deployment

### Dockerfile for API
```dockerfile
FROM ubuntu:22.04

# Install dependencies
RUN apt-get update && apt-get install -y \
    curl wget gnupg \
    xvfb x11-utils xauth \
    fluxbox openbox \
    ffmpeg \
    fonts-liberation libasound2 libatk-bridge2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 18
RUN curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
    && apt-get install -y nodejs

# Install Chrome
RUN wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update \
    && apt-get install -y google-chrome-stable

WORKDIR /app
COPY package-api.json package.json
RUN npm install

COPY api-server.js .
RUN mkdir recordings

EXPOSE 3002

CMD ["npm", "start"]
```

### Build and Run
```bash
# Build Docker image
docker build -f Dockerfile.api -t slides-api .

# Run container
docker run -p 3002:3002 -v $(pwd)/recordings:/app/recordings slides-api
```

## Error Handling

### Common Errors
```json
{
  "error": "Invalid input. Required: slideUrl (string), timings (array)",
  "timestamp": "2024-12-20T14:30:52.123Z"
}

{
  "error": "Missing dependencies: xvfb, google-chrome",
  "timestamp": "2024-12-20T14:30:52.123Z"
}

{
  "error": "Authentication required. Please ensure the presentation is publicly accessible.",
  "recordingId": "uuid-here",
  "timestamp": "2024-12-20T14:30:52.123Z"
}
```

### Status Codes
- `200` - Success
- `400` - Bad Request (invalid input)
- `404` - Recording not found
- `500` - Internal server error

## Integration Examples

### Microservice Architecture
```javascript
// In your main application
const recordingService = {
  async createRecording(slideUrl, timings) {
    const response = await fetch('http://slides-api:3002/record', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slideUrl, timings })
    });
    return response.json();
  },
  
  async getRecording(id) {
    const response = await fetch(`http://slides-api:3002/recording/${id}`);
    return response.json();
  }
};
```

### Queue Integration
```javascript
// With Bull Queue
const Queue = require('bull');
const recordingQueue = new Queue('recording processing');

recordingQueue.process(async (job) => {
  const { slideUrl, timings } = job.data;
  
  const response = await fetch('http://localhost:3002/record', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slideUrl, timings })
  });
  
  return response.json();
});
```

## Performance Notes

- **Concurrent Recordings**: API handles one recording at a time (virtual display limitation)
- **Memory Usage**: ~500MB per recording process
- **CPU Usage**: Moderate during recording, minimal when idle
- **Disk Space**: ~10-50MB per minute of recording

## Security Considerations

- **Input Validation**: URL and timing validation implemented
- **File Access**: Only recordings directory exposed
- **Process Isolation**: Virtual display prevents interference
- **Resource Limits**: Consider adding rate limiting for production

This API provides the same functionality as the bash script but as a web service that can be integrated into any application or microservice architecture!