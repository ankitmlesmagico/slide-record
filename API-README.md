# Google Slides Recording API

A simple REST API for automatically recording Google Slides presentations with timed slide transitions.

## Features

- 🎬 Record Google Slides presentations automatically
- ⏱️ Custom timing for slide transitions
- 🖥️ Uses virtual display for headless recording on macOS
- 🎥 High-quality MP4 output with H.264 encoding
- 📁 Direct file download after completion

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Start the API Server

```bash
npm run start:mac
```

The server will start on `http://localhost:3002`

### 3. Test the API

```bash
# Test with example presentation
node test-api.js

# Test with custom URL and timings
node test-api.js "https://docs.google.com/presentation/d/YOUR_PRESENTATION_ID/edit" "5,10,15,20"
```

## API Endpoint

### POST /api/record

Record a Google Slides presentation and return the file path when complete.

**Request Body:**
```json
{
  "slideUrl": "https://docs.google.com/presentation/d/1234567890/edit",
  "timings": [5, 10, 15, 20]
}
```

**Response (Success):**
```json
{
  "success": true,
  "videoUrl": "http://localhost:9000/slide-recordings/recordings/slideshow_2024-01-01_12345678.mp4",
  "fileName": "slideshow_2024-01-01_12345678.mp4",
  "message": "Recording completed and uploaded to MinIO successfully"
}
```

**Response (Error):**
```json
{
  "success": false,
  "error": "Recording failed"
}
```

**Parameters:**
- `slideUrl` (required): Google Slides presentation URL
- `timings` (required): Array of seconds when to advance slides (must be positive numbers in ascending order)

### GET /api/recordings

List all recordings stored in MinIO.

**Response:**
```json
{
  "success": true,
  "recordings": [
    {
      "name": "recordings/slideshow_2024-01-01_12345678.mp4",
      "url": "http://localhost:9000/slide-recordings/recordings/slideshow_2024-01-01_12345678.mp4",
      "size": 15728640,
      "sizeMB": 15.0,
      "lastModified": "2024-01-01T12:00:00.000Z"
    }
  ]
}
```

### DELETE /api/recording/:filename

Delete a recording from MinIO.

**Response:**
```json
{
  "success": true,
  "message": "Recording deleted successfully from MinIO"
}
```

## Usage Examples

### cURL Example

```bash
curl -X POST http://localhost:3002/api/record \
  -H "Content-Type: application/json" \
  -d '{
    "slideUrl": "https://docs.google.com/presentation/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit",
    "timings": [3, 6, 9, 12, 15]
  }'
```

### JavaScript/Node.js Example

```javascript
const axios = require('axios');

async function recordSlides() {
  try {
    const response = await axios.post('http://localhost:3002/api/record', {
      slideUrl: 'https://docs.google.com/presentation/d/YOUR_ID/edit',
      timings: [5, 10, 15, 20, 25]
    });
    
    console.log('Recording completed!');
    console.log('Video URL:', response.data.videoUrl);
  } catch (error) {
    console.error('Recording failed:', error.response?.data || error.message);
  }
}

recordSlides();
```

### Python Example

```python
import requests

def record_slides():
    response = requests.post('http://localhost:3002/api/record', json={
        'slideUrl': 'https://docs.google.com/presentation/d/YOUR_ID/edit',
        'timings': [5, 10, 15, 20, 25]
    })
    
    if response.status_code == 200:
        data = response.json()
        print('Recording completed!')
        print(f'Video URL: {data["videoUrl"]}')
    else:
        print('Recording failed:', response.json())

record_slides()
```

## Requirements

- macOS (uses the record-slides-mac.sh script)
- Node.js and npm
- Dependencies from record-slides-mac.sh:
  - Xvfb (virtual display)
  - Google Chrome or Chromium
  - FFmpeg
  - Puppeteer (installed via npm)

## Error Handling

The API provides detailed error messages for common issues:
- Invalid Google Slides URL format
- Invalid timing values (must be positive numbers in ascending order)
- Missing required parameters
- Recording process failures

## Notes

- The API waits for the recording to complete before responding
- Recording files are saved in the `recordings/` directory
- Files can be downloaded directly using the returned path
- The recording process may take several minutes depending on presentation length

## Troubleshooting

**API not responding:**
Make sure the server is running: `npm run start:mac`

**Recording fails:**
- Check that the Google Slides URL is publicly accessible
- Ensure all dependencies are installed
- Check server logs for detailed error messages

## License

MIT License

## Usage Examples

### cURL Examples

**Start a recording:**
```bash
curl -X POST http://localhost:3002/api/record \
  -H "Content-Type: application/json" \
  -d '{
    "slideUrl": "https://docs.google.com/presentation/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit",
    "timings": [3, 6, 9, 12, 15]
  }'
```

**Check recording status:**
```bash
curl http://localhost:3002/api/status/your-recording-id
```

**List recordings:**
```bash
curl http://localhost:3002/api/recordings
```

### JavaScript/Node.js Example

```javascript
const axios = require('axios');

async function recordSlides() {
  try {
    // Start recording
    const response = await axios.post('http://localhost:3002/api/record', {
      slideUrl: 'https://docs.google.com/presentation/d/YOUR_ID/edit',
      timings: [5, 10, 15, 20, 25]
    });
    
    const recordingId = response.data.recordingId;
    console.log('Recording started:', recordingId);
    
    // Poll for completion
    while (true) {
      const status = await axios.get(`http://localhost:3002/api/status/${recordingId}`);
      console.log('Status:', status.data.status, '-', status.data.progress);
      
      if (status.data.status === 'completed') {
        console.log('Download URL:', status.data.downloadUrl);
        break;
      } else if (status.data.status === 'failed') {
        console.error('Recording failed:', status.data.error);
        break;
      }
      
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  }
}

recordSlides();
```

### Python Example

```python
import requests
import time
import json

def record_slides():
    # Start recording
    response = requests.post('http://localhost:3002/api/record', json={
        'slideUrl': 'https://docs.google.com/presentation/d/YOUR_ID/edit',
        'timings': [5, 10, 15, 20, 25]
    })
    
    if response.status_code != 200:
        print('Failed to start recording:', response.json())
        return
    
    recording_id = response.json()['recordingId']
    print(f'Recording started: {recording_id}')
    
    # Poll for completion
    while True:
        status_response = requests.get(f'http://localhost:3002/api/status/{recording_id}')
        status_data = status_response.json()
        
        print(f"Status: {status_data['status']} - {status_data['progress']}")
        
        if status_data['status'] == 'completed':
            print(f"Download URL: http://localhost:3002{status_data['downloadUrl']}")
            break
        elif status_data['status'] == 'failed':
            print(f"Recording failed: {status_data.get('error', 'Unknown error')}")
            break
        
        time.sleep(2)

if __name__ == '__main__':
    record_slides()
```

## Requirements

- macOS (uses the record-slides-mac.sh script)
- Node.js and npm
- Dependencies from record-slides-mac.sh:
  - Xvfb (virtual display)
  - Google Chrome or Chromium
  - FFmpeg
  - Puppeteer (installed via npm)

## Configuration

The API server uses these default settings:
- Port: 3002
- Recordings directory: `./recordings`
- Virtual display resolution: 1920x1080
- Video encoding: H.264 with CRF 20

## Error Handling

The API provides detailed error messages for common issues:
- Invalid Google Slides URL format
- Invalid timing values (must be positive numbers in ascending order)
- Missing required parameters
- Recording process failures
- File system errors

## File Management

- Recordings are saved in the `recordings/` directory
- Files are named with timestamp and recording ID
- Optional cleanup of old recordings (7+ days)
- File size information provided in responses

## Troubleshooting

**API not responding:**
```bash
node test-api.js health
```

**Recording fails:**
- Check that the Google Slides URL is publicly accessible
- Ensure all dependencies are installed
- Check server logs for detailed error messages

**Virtual display issues:**
- Verify Xvfb is installed and working
- Check that no other processes are using the display

## Development

**Start in development mode:**
```bash
npm run dev:mac
```

**Run tests:**
```bash
node test-api.js
```

## License

MIT License