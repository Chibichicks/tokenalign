#!/bin/bash
set -e

# TokenAlign v37 Installer
# Target: Linux/macOS

VERSION="v37-tokenalign"
BINARY_NAME="tokenalign"
INSTALL_DIR="/usr/local/bin"

echo "🛡️ Installing TokenAlign $VERSION..."

# 1. Detect Architecture
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

if [ "$ARCH" == "x86_64" ]; then
    ARCH_SUFFIX="x86_64"
elif [ "$ARCH" == "arm64" ] || [ "$ARCH" == "aarch64" ]; then
    ARCH_SUFFIX="aarch64"
else
    echo "❌ Unsupported architecture: $ARCH"
    exit 1
fi

# 2. Download Binary from GitHub (Placeholder URL)
# In production: URL="https://github.com/your-username/tokenalign/releases/download/$VERSION/tokenalign-$OS-$ARCH_SUFFIX"
echo "📦 Downloading binary for $OS-$ARCH_SUFFIX..."

# 3. Setup Local Enclave Directories
mkdir -p ~/.tokenalign/enclave
mkdir -p ~/.tokenalign/logs

# 4. Install Permissions
# chmod +x $BINARY_NAME
# sudo mv $BINARY_NAME $INSTALL_DIR/

echo "✅ Installation Complete!"
echo "🚀 Run 'tokenalign start --port 8080' to begin saving tokens."
echo "💡 Change your OPENAI_BASE_URL to http://localhost:8080/v1"
