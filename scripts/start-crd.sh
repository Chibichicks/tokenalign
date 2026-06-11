#!/bin/bash
# Manual CRD starter script

# Kill any existing processes
pkill -f "chrome-remote-desktop" 2>/dev/null || true
pkill -f "Xvfb :20" 2>/dev/null || true
sleep 1

# Start Xvfb
Xvfb :20 -screen 0 1600x1200x24 &
sleep 2

# Start the desktop environment
export DISPLAY=:20
gnome-terminal --geometry=80x24+10+10 &
sleep 2

# Start CRD host
ln -sf ~/.config/chrome-remote-desktop/host#7c84cb281452472e23cb22046e132456.json ~/.config/chrome-remote-desktop/host.json
DISPLAY=:20 /opt/google/chrome-remote-desktop/chrome-remote-desktop-host --host_config=/home/lucas/.config/chrome-remote-desktop/host.json &

echo "CRD started successfully!"
