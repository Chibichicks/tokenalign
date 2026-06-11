#!/bin/bash
# MCP Alternative: Direct file sync
OBSIDIAN_VAULT="/home/lucas/Documents/Obsidian Vault"
OPENCLAW_MEM="/home/lucas/.openclaw/workspace/memory"

# Sync from Obsidian to Memory
rsync -av "$OBSIDIAN_VAULT/" "$OPENCLAW_MEM/obsidian/" --delete

# Sync memory to Obsidian  
rsync -av "$OPENCLAW_MEM/" "$OBSIDIAN_VAULT/" --exclude='.git' --exclude='*.tmp'

echo "Sync completed at $(date)"
