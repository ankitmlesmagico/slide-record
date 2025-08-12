#!/bin/bash

# MinIO Installation Script for Linux (No Docker)
# This script downloads and installs MinIO server natively

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

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

# Function to detect architecture
detect_architecture() {
    local arch=$(uname -m)
    case $arch in
        x86_64)
            echo "amd64"
            ;;
        aarch64|arm64)
            echo "arm64"
            ;;
        *)
            print_error "Unsupported architecture: $arch"
            exit 1
            ;;
    esac
}

# Function to check if running as root for system installation
check_permissions() {
    if [ "$INSTALL_SYSTEM_WIDE" = "true" ] && [ "$EUID" -ne 0 ]; then
        print_error "System-wide installation requires root privileges"
        echo "Run with sudo or set INSTALL_SYSTEM_WIDE=false for user installation"
        exit 1
    fi
}

# Function to install MinIO
install_minio() {
    local arch=$(detect_architecture)
    local install_dir
    local binary_name="minio"
    
    if [ "$INSTALL_SYSTEM_WIDE" = "true" ]; then
        install_dir="/usr/local/bin"
        print_status "Installing MinIO system-wide to $install_dir"
    else
        install_dir="$HOME/.local/bin"
        mkdir -p "$install_dir"
        print_status "Installing MinIO for current user to $install_dir"
        
        # Add to PATH if not already there
        if [[ ":$PATH:" != *":$install_dir:"* ]]; then
            echo "export PATH=\"$install_dir:\$PATH\"" >> ~/.bashrc
            print_warning "Added $install_dir to PATH in ~/.bashrc"
            print_warning "Run 'source ~/.bashrc' or restart your terminal"
        fi
    fi
    
    # Check if MinIO is already installed
    if command -v minio &> /dev/null; then
        local current_version=$(minio --version 2>/dev/null | head -n1 || echo "unknown")
        print_warning "MinIO is already installed: $current_version"
        read -p "Do you want to reinstall? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            print_status "Installation cancelled"
            exit 0
        fi
    fi
    
    print_status "Downloading MinIO for $arch architecture..."
    
    # Download MinIO binary
    local download_url="https://dl.min.io/server/minio/release/linux-${arch}/minio"
    local temp_file="/tmp/minio-download"
    
    if command -v wget &> /dev/null; then
        wget -q --show-progress -O "$temp_file" "$download_url"
    elif command -v curl &> /dev/null; then
        curl -L --progress-bar -o "$temp_file" "$download_url"
    else
        print_error "Neither wget nor curl is available"
        print_error "Please install wget or curl and try again"
        exit 1
    fi
    
    # Verify download
    if [ ! -f "$temp_file" ] || [ ! -s "$temp_file" ]; then
        print_error "Download failed or file is empty"
        exit 1
    fi
    
    # Make executable and move to install directory
    chmod +x "$temp_file"
    
    if [ "$INSTALL_SYSTEM_WIDE" = "true" ]; then
        sudo mv "$temp_file" "$install_dir/$binary_name"
    else
        mv "$temp_file" "$install_dir/$binary_name"
    fi
    
    print_success "MinIO installed successfully to $install_dir/$binary_name"
    
    # Verify installation
    if command -v minio &> /dev/null; then
        local version=$(minio --version 2>/dev/null | head -n1 || echo "unknown")
        print_success "Installation verified: $version"
    else
        print_warning "MinIO installed but not found in PATH"
        print_warning "You may need to restart your terminal or run 'source ~/.bashrc'"
    fi
}

# Function to install MinIO Client (mc) - optional
install_minio_client() {
    if [ "$INSTALL_MC" != "true" ]; then
        return
    fi
    
    local arch=$(detect_architecture)
    local install_dir
    local binary_name="mc"
    
    if [ "$INSTALL_SYSTEM_WIDE" = "true" ]; then
        install_dir="/usr/local/bin"
    else
        install_dir="$HOME/.local/bin"
    fi
    
    print_status "Installing MinIO Client (mc)..."
    
    # Download MinIO Client binary
    local download_url="https://dl.min.io/client/mc/release/linux-${arch}/mc"
    local temp_file="/tmp/mc-download"
    
    if command -v wget &> /dev/null; then
        wget -q --show-progress -O "$temp_file" "$download_url"
    elif command -v curl &> /dev/null; then
        curl -L --progress-bar -o "$temp_file" "$download_url"
    fi
    
    # Make executable and move to install directory
    chmod +x "$temp_file"
    
    if [ "$INSTALL_SYSTEM_WIDE" = "true" ]; then
        sudo mv "$temp_file" "$install_dir/$binary_name"
    else
        mv "$temp_file" "$install_dir/$binary_name"
    fi
    
    print_success "MinIO Client (mc) installed successfully"
}

# Function to create sample configuration
create_sample_config() {
    if [ "$CREATE_CONFIG" != "true" ]; then
        return
    fi
    
    local config_dir="$HOME/.minio"
    mkdir -p "$config_dir"
    
    cat > "$config_dir/config.env" << EOF
# MinIO Configuration
MINIO_ROOT_USER=minioadmin
MINIO_ROOT_PASSWORD=minioadmin
MINIO_DATA_DIR=$HOME/minio-data
MINIO_API_PORT=9000
MINIO_CONSOLE_PORT=9001
EOF
    
    print_success "Sample configuration created at $config_dir/config.env"
    print_status "Edit this file to customize your MinIO settings"
}

# Function to show post-installation instructions
show_instructions() {
    echo
    print_success "MinIO installation completed!"
    echo
    echo "Next steps:"
    echo "1. Create data directory: mkdir -p ~/minio-data"
    echo "2. Start MinIO server: ./start-minio.sh"
    echo "3. Access console at: http://localhost:9001"
    echo "4. Default credentials: minioadmin / minioadmin"
    echo
    echo "For the Slides Recording API:"
    echo "1. Install Node.js dependencies: npm install minio"
    echo "2. Start the API: node slides-recording-api-minio.js"
    echo
    echo "Useful commands:"
    echo "  minio --version          # Check MinIO version"
    echo "  ./start-minio.sh --help  # MinIO startup options"
    if [ "$INSTALL_MC" = "true" ]; then
        echo "  mc --version             # Check MinIO client version"
    fi
}

# Main function
main() {
    echo "=================================================="
    echo "         MinIO Installation Script (No Docker)"
    echo "=================================================="
    echo
    
    # Default configuration
    INSTALL_SYSTEM_WIDE="${INSTALL_SYSTEM_WIDE:-false}"
    INSTALL_MC="${INSTALL_MC:-false}"
    CREATE_CONFIG="${CREATE_CONFIG:-true}"
    
    # Parse command line arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            --system)
                INSTALL_SYSTEM_WIDE=true
                shift
                ;;
            --user)
                INSTALL_SYSTEM_WIDE=false
                shift
                ;;
            --with-client)
                INSTALL_MC=true
                shift
                ;;
            --no-config)
                CREATE_CONFIG=false
                shift
                ;;
            -h|--help)
                echo "Usage: $0 [OPTIONS]"
                echo
                echo "Options:"
                echo "  --system        Install system-wide (requires sudo)"
                echo "  --user          Install for current user only (default)"
                echo "  --with-client   Also install MinIO client (mc)"
                echo "  --no-config     Don't create sample configuration"
                echo "  -h, --help      Show this help message"
                echo
                echo "Environment Variables:"
                echo "  INSTALL_SYSTEM_WIDE=true   Install system-wide"
                echo "  INSTALL_MC=true            Install MinIO client"
                echo "  CREATE_CONFIG=false        Skip config creation"
                exit 0
                ;;
            *)
                print_error "Unknown option: $1"
                echo "Use --help for usage information"
                exit 1
                ;;
        esac
    done
    
    # Show configuration
    print_status "Installation configuration:"
    echo "  System-wide: $INSTALL_SYSTEM_WIDE"
    echo "  Install MC client: $INSTALL_MC"
    echo "  Create config: $CREATE_CONFIG"
    echo
    
    # Check permissions
    check_permissions
    
    # Install MinIO
    install_minio
    
    # Install MinIO Client if requested
    install_minio_client
    
    # Create sample configuration
    create_sample_config
    
    # Show instructions
    show_instructions
}

# Run main function
main "$@"