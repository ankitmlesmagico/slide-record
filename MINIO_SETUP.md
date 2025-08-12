# MinIO Setup Guide for Google Slides Recording API

## Overview

This guide will help you set up MinIO (S3-compatible object storage) natively on Linux to store your recorded slide presentations in the cloud instead of locally.

## Quick Start - Native Installation

### 1. Automated Installation (Recommended)

```bash
# Run the installation script
./install-minio.sh

# Or install system-wide (requires sudo)
./install-minio.sh --system

# Or install with MinIO client
./install-minio.sh --with-client
```

### 2. Manual Installation

```bash
# Download MinIO binary for Linux
wget https://dl.min.io/server/minio/release/linux-amd64/minio
chmod +x minio
sudo mv minio /usr/local/bin/

# Verify installation
minio --version
```

### 3. Start MinIO Server

```bash
# Using the startup script (recommended)
./start-minio.sh

# Or manually
export MINIO_ROOT_USER=minioadmin
export MINIO_ROOT_PASSWORD=minioadmin
mkdir -p ~/minio-data
minio server ~/minio-data --console-address ":9001"
```

### 4. Access MinIO Console

Open your browser and go to: http://localhost:9001

- **Username**: minioadmin
- **Password**: minioadmin

### 5. Install Dependencies and Start API

```bash
# Install MinIO client for Node.js
npm install minio

# Start the API with MinIO support
node slides-recording-api-minio.js
```

## Environment Configuration

You can customize MinIO settings using environment variables:

```bash
# MinIO server configuration
export MINIO_ENDPOINT=localhost
export MINIO_PORT=9000
export MINIO_USE_SSL=false
export MINIO_ACCESS_KEY=minioadmin
export MINIO_SECRET_KEY=minioadmin
export MINIO_BUCKET=slide-recordings

# Start the API
node slides-recording-api-minio.js
```

## Production Setup - Systemd Service

### 1. Create Systemd Service

```bash
# Download MinIO binary
wget https://dl.min.io/server/minio/release/linux-amd64/minio
chmod +x minio
sudo mv minio /usr/local/bin/

# Create MinIO user and directories
sudo useradd -r minio-user -s /sbin/nologin
sudo mkdir -p /opt/minio/data
sudo chown minio-user:minio-user /opt/minio/data

# Create systemd service
sudo tee /etc/systemd/system/minio.service > /dev/null <<EOF
[Unit]
Description=MinIO
Documentation=https://docs.min.io
Wants=network-online.target
After=network-online.target
AssertFileIsExecutable=/usr/local/bin/minio

[Service]
WorkingDirectory=/opt/minio
User=minio-user
Group=minio-user
EnvironmentFile=-/etc/default/minio
ExecStartPre=/bin/bash -c "if [ -z \"\${MINIO_VOLUMES}\" ]; then echo \"Variable MINIO_VOLUMES not set in /etc/default/minio\"; exit 1; fi"
ExecStart=/usr/local/bin/minio server \$MINIO_OPTS \$MINIO_VOLUMES
Restart=always
LimitNOFILE=65536
TasksMax=infinity
TimeoutStopSec=infinity
SendSIGKILL=no

[Install]
WantedBy=multi-user.target
EOF

# Create environment file
sudo tee /etc/default/minio > /dev/null <<EOF
MINIO_ROOT_USER=your-access-key
MINIO_ROOT_PASSWORD=your-secret-key-min-8-chars
MINIO_VOLUMES="/opt/minio/data"
MINIO_OPTS="--console-address :9001"
EOF

# Start MinIO service
sudo systemctl daemon-reload
sudo systemctl enable minio
sudo systemctl start minio
```

## API Configuration

### Environment Variables

```bash
# Required MinIO settings
export MINIO_ENDPOINT=your-minio-server.com  # or localhost
export MINIO_PORT=9000
export MINIO_USE_SSL=false                   # true for HTTPS
export MINIO_ACCESS_KEY=your-access-key
export MINIO_SECRET_KEY=your-secret-key
export MINIO_BUCKET=slide-recordings

# Optional API settings
export PORT=3003
```

### Configuration File

Create `.env` file:
```env
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_USE_SSL=false
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=slide-recordings
PORT=3003
```

## Testing the Setup

### 1. Check MinIO Health

```bash
curl http://localhost:3003/health
```

Expected response should show MinIO status as "connected".

### 2. Test Recording

```bash
curl -X POST http://localhost:3003/record \
  -H "Content-Type: application/json" \
  -d '{
    "slideUrl": "https://docs.google.com/presentation/d/your-id/edit",
    "timings": [5, 8, 12]
  }'
```

### 3. Run Test Script

```bash
node test-api-minio.js
```

## Troubleshooting

### Common Issues

1. **MinIO Connection Failed**
   ```bash
   # Check if MinIO is running
   ps aux | grep minio
   # or (if using systemd)
   sudo systemctl status minio
   
   # Check MinIO logs
   # If running manually, check terminal output
   # If using systemd:
   sudo journalctl -u minio -f
   ```

2. **Bucket Creation Failed**
   - Ensure MinIO credentials are correct
   - Check MinIO server logs
   - Verify network connectivity

3. **Upload Failed**
   - Check disk space on MinIO server
   - Verify bucket permissions
   - Check file size limits

4. **URL Not Accessible**
   - Verify bucket policy allows public read
   - Check firewall settings
   - Ensure MinIO is accessible from client

### MinIO Console Access

1. Open http://localhost:9001 (or your MinIO console URL)
2. Login with your credentials
3. Check:
   - Bucket exists and has correct permissions
   - Files are being uploaded
   - Access policies are set correctly

### Network Configuration

For production deployments:

1. **Firewall Rules**
   ```bash
   # Allow MinIO API port
   sudo ufw allow 9000
   # Allow MinIO Console port
   sudo ufw allow 9001
   ```

2. **Reverse Proxy (Nginx)**
   ```nginx
   server {
       listen 80;
       server_name your-minio-domain.com;
       
       location / {
           proxy_pass http://localhost:9000;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
       }
   }
   ```

## Security Best Practices

1. **Change Default Credentials**
   ```bash
   # Use strong, unique credentials
   MINIO_ROOT_USER=your-unique-access-key
   MINIO_ROOT_PASSWORD=your-strong-password-min-8-chars
   ```

2. **Enable HTTPS**
   ```bash
   # Use SSL certificates
   export MINIO_USE_SSL=true
   ```

3. **Restrict Bucket Access**
   - Set appropriate bucket policies
   - Use IAM users for different access levels
   - Enable versioning for important data

4. **Network Security**
   - Use VPN or private networks
   - Implement proper firewall rules
   - Consider using reverse proxy

## Monitoring

### Health Checks

```bash
# API health with MinIO status
curl http://localhost:3003/health

# MinIO server health
curl http://localhost:9000/minio/health/live
```

### Storage Usage

```bash
# List all recordings
curl http://localhost:3003/recordings

# MinIO admin info (requires mc client)
mc admin info local
```

## Backup and Recovery

### Backup MinIO Data

```bash
# Using rsync
rsync -av ~/minio-data/ ~/minio-backup/

# Using MinIO client
mc mirror local/slide-recordings backup/slide-recordings
```

### Restore Data

```bash
# Restore from backup
rsync -av ~/minio-backup/ ~/minio-data/

# Or using MinIO client
mc mirror backup/slide-recordings local/slide-recordings
```

This setup provides a robust, scalable solution for storing your slide recordings in the cloud with MinIO!