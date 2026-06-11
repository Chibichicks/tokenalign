#!/usr/bin/env python3
"""
File Audit — weekly scan of ~/ for misplaced files.
Reports violations and can optionally auto-organize.

Scheduled via cron: 0 6 * * 0 /home/lucas/scripts/file_audit.py
"""

import os
import sys
from pathlib import Path
from datetime import datetime

HOME = Path("/home/lucas")
REPORT_FILE = HOME / "Documents/staging/file_audit_report.md"

KNOWN_GOOD_PREFIXES = (".", "Documents", "scripts", ".hermes", ".config", ".local",
                       ".cache", ".gbrain", "gstack", ".openclaw", ".claude",
                       ".dropbox", ".gnome", ".mozilla", ".npm", ".bun",
                       ".ollama", ".pm2", ".presage", ".pki", ".dbus",
                       ".dotnet", ".fontconfig", ".gemini", ".gstack",
                       ".hardinfo", ".icons", ".kimi", ".linuxmint",
                       ".themes", ".var", ".vscode", ".vscode-shared",
                       ".gtkrc", ".bashrc", ".zshrc", ".profile",
                       ".Xauthority", ".gitconfig", ".npmrc",
                       "go", "tg_bot", "snap",
                       "squashfs-root", "rustdesk-config-backup",
                       "node_modules",
                       )

ALLOWED_ROOT_FILES = {
    "obsidian.AppImage",
    "CLAUDE.md",
    ".claude.json",
    "SOUL.md",
    "litellm_config.yaml",
    "package.json",
    "package-lock.json",
    "FETCH_HEAD",
    "models.json",
    ".env",
}


def scan():
    """Scan ~/ for misplaced files."""
    misplaced = []
    for item in sorted(HOME.iterdir()):
        name = item.name

        # Skip known-good directories and dotfiles
        if name.startswith(KNOWN_GOOD_PREFIXES):
            continue

        # Skip explicitly allowed root files
        if name in ALLOWED_ROOT_FILES:
            continue

        # Skip directories (they're supposed to be at root)
        if item.is_dir():
            continue

        # Remaining files at root are misplaced
        size = item.stat().st_size
        modified = datetime.fromtimestamp(item.stat().st_mtime)
        misplaced.append((name, size, modified))

    return misplaced


def generate_report(misplaced):
    """Generate markdown audit report."""
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    lines = [
        f"# File Audit Report",
        f"",
        f"**Date:** {now}",
        f"**Status:** {'✅ Clean' if not misplaced else '⚠️ Issues found'}",
        f"",
    ]

    if not misplaced:
        lines.extend([
            "No misplaced files found at ~/ root.",
            "",
            "The file guardian is working correctly.",
        ])
    else:
        lines.extend([
            f"## Misplaced Files at ~/ ({len(misplaced)} found)",
            "",
            "| File | Size | Last Modified |",
            "|------|------|---------------|",
        ])
        for name, size, modified in misplaced:
            size_str = f"{size / 1024:.1f} KB" if size < 1024 * 1024 else f"{size / (1024 * 1024):.1f} MB"
            lines.append(f"| `{name}` | {size_str} | {modified.strftime('%Y-%m-%d %H:%M')} |")

        lines.extend([
            "",
            "These files will be automatically moved by the file guardian on its next run.",
            "If they should stay at root, add them to ALLOWED_ROOT_FILES in file_audit.py.",
        ])

    return "\n".join(lines)


def main():
    print("Running weekly file audit...")
    misplaced = scan()

    report = generate_report(misplaced)
    REPORT_FILE.parent.mkdir(parents=True, exist_ok=True)
    REPORT_FILE.write_text(report)

    status = "CLEAN" if not misplaced else f"ISSUES ({len(misplaced)} misplaced)"
    print(f"Audit complete — {status}")
    print(f"Report saved to {REPORT_FILE}")
    return 0 if not misplaced else 1


if __name__ == "__main__":
    sys.exit(main())
