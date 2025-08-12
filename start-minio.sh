#!/bin/bash

# MinIO Startup Script (No Docker)
# This script starts MinIO server natively on Linux

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
MINIO_DATA_DIR="${MINIO_DATA_DIR:-$HOME/minio-data}"
MINIO_ROOT_USER="${MINIO_ROOT_USER:-minioadmin}"
MINIO_ROOT_PASSWORD="${MINIO_ROOT_PASSWORD:-minioadmin}"
MINIO_API_PORT="${MINIO_API_PORT:-9000}"
MINIO_CONSOLE_PORT="${MINIO_CONSOLE_PORT:-9001}"

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

# Function to check if MinIO is installed
check_minio_installation() {
    if ! command -v minio &> /dev/null; then
        print_error "MinIO is not installed!"
        echo
        echo "To install MinIO:"
        echo "1. Download: wget https://dl.min.io/server/minio/release/linux-amd64/minio"
        echo "2. Make executable: chmod +x minio"
        echo "3. Move to PATH: sudo mv minio /usr/local/bin/"
        echo
        exit 1
    fi
    
    print_success "MinIO binary found: $(which minio)"
}

# Function to setup data directory
setup_data_directory() {
    print_status "Setting up data directory: $MINIO_DATA_DIR"
    
    if [ ! -d "$MINIO_DATA_DIR" ]; then
        mkdir -p "$MINIO_DATA_DIR"
        print_success "Created data directory: $MINIO_DATA_DIR"
    else
        print_status "Data directory already exists: $MINIO_DATA_DIR"
    fi
}

# Function to check if ports are available
check_ports() {
    print_status "Checking if ports are available..."
    
    if lsof -Pi :$MINIO_API_PORT -sTCP:LISTEN -t >/dev/null 2>&1; then
        print_error "Port $MINIO_API_PORT is already in use!"
        echo "Please stop the service using this port or change MINIO_API_PORT"
        exit 1
    fi
    
    if lsof -Pi :$MINIO_CONSOLE_PORT -sTCP:LISTEN -t >/dev/null 2>&1; then
        print_error "Port $MINIO_CONSOLE_PORT is already in use!"
        echo "Please stop the service using this port or change MINIO_CONSOLE_PORT"
        exit 1
    fi
    
    print_success "Ports $MINIO_API_PORT and $MINIO_CONSOLE_PORT are available"
}

# Function to validate credentials
validate_credentials() {
    if [ ${#MINIO_ROOT_USER} -lt 3 ]; then
        print_error "MINIO_ROOT_USER must be at least 3 characters long"
        exit 1
    fi
    
    if [ ${#MINIO_ROOT_PASSWORD} -lt 8 ]; then
        print_error "MINIO_ROOT_PASSWORD must be at least 8 characters long"
        exit 1
    fi
    
    print_success "Credentials validated"
}

# Function to start MinIO server
start_minio() {
    print_status "Starting MinIO server..."
    
    export MINIO_ROOT_USER="$MINIO_ROOT_USER"
    export MINIO_ROOT_PASSWORD="$MINIO_ROOT_PASSWORD"
    
    print_status "Configuration:"
    echo "  Data Directory: $MINIO_DATA_DIR"
    echo "  API Port: $MINIO_API_PORT"
    echo "  Console Port: $MINIO_CONSOLE_PORT"
    echo "  Root User: $MINIO_ROOT_USER"
    echo "  Root Password: [HIDDEN]"
    echo
    
    print_status "Starting MinIO server..."
    print_status "API will be available at: http://localhost:$MINIO_API_PORT"
    print_status "Console will be available at: http://localhost:$MINIO_CONSOLE_PORT"
    print_warning "Press Ctrl+C to stop the server"
    echo
    
    # Start MinIO server
    minio server "$MINIO_DATA_DIR" \
        --address ":$MINIO_API_PORT" \
        --console-address ":$MINIO_CONSOLE_PORT"
}

# Function to show usage
show_usage() {
    echo "MinIO Startup Script"
    echo
    echo "Usage: $0 [OPTIONS]"
    echo
    echo "Environment Variables:"
    echo "  MINIO_DATA_DIR       Data directory (default: $HOME/minio-data)"
    echo "  MINIO_ROOT_USER      Root username (default: minioadmin)"
    echo "  MINIO_ROOT_PASSWORD  Root password (default: minioadmin)"
    echo "  MINIO_API_PORT       API port (default: 9000)"
    echo "  MINIO_CONSOLE_PORT   Console port (default: 9001)"
    echo
    echo "Examples:"
    echo "  $0                                    # Start with defaults"
    echo "  MINIO_DATA_DIR=/data/minio $0         # Custom data directory"
    echo "  MINIO_ROOT_USER=admin $0              # Custom username"
    echo
}

# Main function
main() {
    echo "=================================================="
    echo "           MinIO Server Startup Script"
    echo "=================================================="
    echo
    
    # Parse command line arguments
    case "${1:-}" in
        -h|--help)
            show_usage
            exit 0
            ;;
        -*)
            print_error "Unknown option: $1"
            show_usage
            exit 1
            ;;
    esac
    
    # Run checks and setup
    check_minio_installation
    validate_credentials
    setup_data_directory
    check_ports
    
    echo
    print_success "All checks passed! Starting MinIO server..."
    echo
    
    # Start MinIO
    start_minio
}

# Handle Ctrl+C gracefully
trap 'echo -e "\n${YELLOW}[INFO]${NC} Shutting down MinIO server..."; exit 0' INT

# Run main function
main "$@"