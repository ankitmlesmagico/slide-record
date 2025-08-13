# Google Slides Recording API - Docker Setup

This guide helps you run the Google Slides Recording API and MinIO using Docker containers.

## Prerequisites

- Docker (20.10+)
- Docker Compose (1.29+)
- At least 4GB RAM available for containers
- Internet connection for downloading dependencies

## Quick Start

### 1. Start Services

```bash
# Make the startup script executable (if not already)
chmod +x docker-start.sh

# Start all services
./docker-start.sh start
```

This will:
- Build the slides-recorder Docker image
- Start MinIO service
- Start the recording API service
- Wait for services to be healthy
- Run basic API tests

### 2. Access Services

Once started, you can access:

- **Recording API**: http://localhost:3003
- **MinIO Console**: http://localhost:9001 (login: minioadmin/minioadmin123)
- **MinIO API**: http://localhost:9000

### 3. Test Recording

```bash
# Run the test script
./test-recording.sh
```

Or manually test with curl:

```bash
curl -X POST http://localhost:3003/record \
  -H "Content-Type: application/json" \
  -d '{
    "slideUrl": "https://docs.google.com/presentation/d/YOUR_PRESENTATION_ID/edit",
    "timings": [3, 6, 9, 12]
  }'
```

## Management Commands

```bash
# Start services
./docker-start.sh start

# Stop services
./docker-start.sh stop

# Restart services
./docker-start.sh restart

# View logs
./docker-start.sh logs

# Check status
./docker-start.sh status

# Cleanup (removes volumes)
./docker-start.sh cleanup

# Test API endpoints
./docker-start.sh test
```

## Configuration

### Environment Variables

The services use these environment variables (defined in docker-compose.yml):

```yaml
# Recording Service
PORT: 3003
MINIO_ENDPOINT: minio
MINIO_PORT: 9000
MINIO_USE_SSL: false
MINIO_ACCESS_KEY: minioadmin
MINIO_SECRET_KEY: minioadmin123
MINIO_BUCKET: slide-recordings

# MinIO Service
MINIO_ROOT_USER: minioadmin
MINIO_ROOT_PASSWORD: minioadmin123
```

### Customization

To customize the setup:

1. **Change ports**: Edit the `ports` section in `docker-compose.yml`
2. **Change credentials**: Update environment variables in `docker-compose.yml`
3. **Persistent storage**: MinIO data is stored in a Docker volume `minio_data`

## Troubleshooting

### Common Issues

1. **Port conflicts**
   ```bash
   # Check what's using the ports
   sudo lsof -i :3003
   sudo lsof -i :9000
   sudo lsof -i :9001
   ```

2. **Services not starting**
   ```bash
   # Check logs
   ./docker-start.sh logs
   
   # Check Docker daemon
   docker info
   ```

3. **Chrome/Puppeteer issues**
   ```bash
   # Check container logs
   docker logs slides-recorder
   
   # Exec into container for debugging
   docker exec -it slides-recorder bash
   ```

4. **MinIO connection issues**
   ```bash
   # Test MinIO health
   curl http://localhost:9000/minio/health/live
   
   # Check MinIO logs
   docker logs slides-minio
   ```

### Memory Issues

If you encounter memory issues:

1. **Increase Docker memory limit** (Docker Desktop settings)
2. **Reduce Chrome processes** by modifying Puppeteer args in the code
3. **Monitor resource usage**:
   ```bash
   docker stats
   ```

### Recording Issues

1. **Slides not accessible**: Ensure the Google Slides URL is publicly accessible
2. **Authentication required**: The presentation must be viewable without login
3. **Timing issues**: Adjust the timings array based on slide content complexity

## Development

### Building Custom Image

```bash
# Build only the recording service
docker-compose build slides-recorder

# Build with no cache
docker-compose build --no-cache slides-recorder
```

### Local Development

For local development without Docker:

1. Copy environment variables:
   ```bash
   cp .env.docker .env
   # Edit .env to use localhost instead of service names
   ```

2. Start MinIO locally:
   ```bash
   ./start-minio.sh
   ```

3. Run the application:
   ```bash
   npm start
   ```

## Production Deployment

For production deployment:

1. **Change default credentials** in docker-compose.yml
2. **Use environment files** for sensitive data
3. **Set up reverse proxy** (nginx) for HTTPS
4. **Configure backup** for MinIO data volume
5. **Monitor resource usage** and scale accordingly

## API Documentation

### Endpoints

- `GET /` - Service information
- `GET /health` - Health check
- `POST /record` - Start recording

### Recording Request

```json
{
  "slideUrl": "https://docs.google.com/presentation/d/PRESENTATION_ID/edit",
  "timings": [3, 6, 9, 12]
}
```

### Recording Response

```json
{
  "success": true,
  "recordingId": "uuid-here",
  "downloadUrl": "http://localhost:9000/slide-recordings/slideshow_uuid.mp4",
  "fileSize": 12345678,
  "fileSizeMB": 11.77,
  "message": "Recording completed and uploaded to MinIO successfully.",
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```

## Support

If you encounter issues:

1. Check the logs: `./docker-start.sh logs`
2. Verify system requirements
3. Ensure Docker has sufficient resources
4. Test with a simple, public Google Slides presentation first