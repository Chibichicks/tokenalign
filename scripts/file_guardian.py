#!/usr/bin/env python3
"""
File Guardian — watches ~/ for misplaced files and routes them to ~/Documents/.

Scheduled via cron: */3 * * * * /home/lucas/scripts/file_guardian.py
Uses a state file to track already-seen files.
Failure mode: unrecognized files go to ~/Documents/staging/ (never left at ~/ root).

Supports:
  --dry-run    Show what would be moved without moving
  --undo       Reverse last run (from log)
  --initial    Process ALL files in ~/ (first-time cleanup)
"""

import os
import json
import shutil
import sys
import time
from pathlib import Path
from datetime import datetime

HOME = Path("/home/lucas")
STATE_FILE = HOME / ".file_guardian_state.json"
LOG_FILE = HOME / ".file_guardian.log"
STAGING_DIR = HOME / "Documents/staging"
KNOWN_GOOD_PREFIXES = (".", "Documents", "scripts", ".hermes", ".config", ".local",
                       ".cache", ".gbrain", "gstack", ".openclaw", ".claude",
                       ".dropbox", ".gnome", ".mozilla", ".npm", ".bun",
                       ".ollama", ".pm2", ".presage", ".pki", ".dbus",
                       ".dotnet", ".fontconfig", ".gemini", ".gstack",
                       ".hardinfo", ".icons", ".kimi", ".linuxmint",
                       ".themes", ".var", ".vscode", ".vscode-shared",
                       ".gtkrc", ".gtkrc-2.0", ".gtkrc-xfce",
                       ".bashrc", ".zshrc", ".profile", ".bash_logout",
                       ".Xauthority", ".xsession-errors",
                       ".sudo_as_admin_successful", ".wget-hsts",
                       ".lesshst", ".npmrc", ".gitconfig",
                       ".chrome-remote-desktop-session",
                       "go", "tg_bot", "snap", ".snap",
                       "squashfs-root", ".squashfs-root",
                       "node_modules", ".nvm",
                       "rustdesk-config-backup",
                       ".stfolder",  # Syncthing marker
                       )

# Files explicitly allowed to stay at ~/ root
ALLOWED_ROOT_FILES = {
    "CLAUDE.md",
    ".claude.json",
    "SOUL.md",
    "litellm_config.yaml",
    "obsidian.AppImage",
    "package.json",
    "package-lock.json",
    "FETCH_HEAD",
    "models.json",
    ".env",
}

# Routing rules: (prefix_pattern, destination_subdir)
ROUTING_RULES = [
    # Job search results
    ("job_search_results_", "Documents/job_search/results/"),
    ("job_search_errors_", "Documents/job_search/errors/"),
    ("job_search_logs", "Documents/job_search/logs/"),
    ("error_monitor.log", "Documents/job_search/logs/"),

    # Obsidian / notes
    ("nate_b_jones_", "Documents/Obsidian Vault/"),
    ("tax_job_search", "Documents/job_search/results/"),
    ("ai_strategy_analysis", "Documents/ai_strategy/"),
    ("job_search_summary", "Documents/job_search/results/"),
    ("job_search_implementation", "Documents/job_search/results/"),

    # Video / transcript files
    ("video_transcript", "Documents/transcripts/"),
    ("video_", "Documents/media/"),
    ("_transcript", "Documents/transcripts/"),
    (".vtt", "Documents/media/subtitles/"),
    (".srt", "Documents/media/subtitles/"),
    ("transcript.txt", "Documents/transcripts/"),
    ("transcribe", "Documents/transcripts/"),

    # Extracted content
    ("extract_", "scripts/"),  # Scripts belong in scripts/
    ("sync_obsidian", "scripts/"),
    ("start-crd", "scripts/"),
    ("check_youtube", "scripts/"),
    ("fetch_transcript", "scripts/"),
    ("get_transcript", "scripts/"),

    # Audio files
    (".wav", "Documents/media/"),
    (".mp3", "Documents/media/"),
    (".mp4", "Documents/media/"),

    # Resume
    ("resume_", "Documents/job_search/resumes/"),
    (".docx", "Documents/job_search/resumes/"),

    # Analysis reports
    ("_analysis.", "Documents/Obsidian Vault/"),
    ("_research.", "Documents/Obsidian Vault/"),

    # Cron / log files
    ("crontab_config", "Documents/job_search/"),
    (".log", "Documents/job_search/logs/"),

    # Note: no blanket .txt rule — specific patterns like "_transcript.txt"
    # are caught above; anything else falls through to staging.
]


def load_state():
    """Load the set of known files from state file."""
    if STATE_FILE.exists():
        try:
            data = json.loads(STATE_FILE.read_text())
            return set(data.get("known_files", []))
        except (json.JSONDecodeError, KeyError):
            return set()
    return set()


def save_state(known_files):
    """Save the set of known files to state file."""
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    data = {
        "known_files": sorted(known_files),
        "updated_at": datetime.now().isoformat()
    }
    STATE_FILE.write_text(json.dumps(data, indent=2))


def log_action(action, src, dst=None):
    """Log a guardian action."""
    LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().isoformat()
    entry = {"timestamp": timestamp, "action": action, "source": str(src)}
    if dst:
        entry["destination"] = str(dst)
    with open(LOG_FILE, "a") as f:
        f.write(json.dumps(entry) + "\n")
    print(f"[{timestamp}] {action}: {src}" + (f" → {dst}" if dst else ""))


def classify_file(filename):
    """Classify a filename and return the destination directory relative to HOME.
    Returns None if the file should not be moved.
    """
    for pattern, destination in ROUTING_RULES:
        if pattern.startswith("."):
            # Extension match
            if filename.endswith(pattern):
                return HOME / destination
        elif pattern in filename:
            return HOME / destination
    return STAGING_DIR  # Failure mode: never leave at root


def is_known_good(item: Path):
    """Check if a path is a known-good directory or file (should not be moved)."""
    name = item.name

    # Skip the state file and log
    if name == ".file_guardian_state.json" or name == ".file_guardian.log":
        return True

    # Skip explicitly allowed root files
    if name in ALLOWED_ROOT_FILES:
        return True

    # Skip known-good prefixes
    for prefix in KNOWN_GOOD_PREFIXES:
        if name.startswith(prefix):
            return True

    # Skip directories that are already in the right place
    if item.is_dir():
        return True

    # Skip files that are already within Documents/ or scripts/
    try:
        resolved = item.resolve()
        if "Documents" in resolved.parts or resolved.parent == (HOME / "scripts"):
            return True
    except (ValueError, OSError):
        pass

    return False


def scan_and_move(dry_run=False, initial=False):
    """Scan ~/ for misplaced files and move them."""
    known_files = load_state()
    current_files = set()

    if not STAGING_DIR.exists():
        STAGING_DIR.mkdir(parents=True, exist_ok=True)

    moves = []
    errors = []

    for item in sorted(HOME.iterdir()):
        current_files.add(str(item))

        # Skip if already known (unless initial cleanup)
        if not initial and str(item) in known_files:
            continue

        # Skip known-good items
        if is_known_good(item):
            continue

        # Skip directories entirely (only move files)
        if item.is_dir():
            continue

        # Classify and move
        dest_dir = classify_file(item.name)

        # Ensure destination exists
        if not dest_dir.exists():
            dest_dir.mkdir(parents=True, exist_ok=True)

        dest_path = dest_dir / item.name

        # Handle name collisions
        if dest_path.exists():
            stem = dest_path.stem
            suffix = dest_path.suffix
            dest_path = dest_dir / f"{stem}_{int(time.time())}{suffix}"

        if dry_run:
            print(f"[DRY-RUN] Would move: {item.name} → {dest_dir.name}/")
            moves.append((str(item), str(dest_path)))
        else:
            try:
                shutil.move(str(item), str(dest_path))
                log_action("MOVE", item, dest_path)
                moves.append((str(item), str(dest_path)))
            except Exception as e:
                log_action("ERROR", item, f"{dest_path} - {e}")
                errors.append((str(item), str(e)))

    # Update state with current files
    if not dry_run:
        save_state(current_files)

    return moves, errors


def undo_last_run():
    """Reverse the last guardian run (from log)."""
    if not LOG_FILE.exists():
        print("No log file found. Nothing to undo.")
        return

    with open(LOG_FILE) as f:
        lines = f.readlines()

    if not lines:
        print("Log is empty. Nothing to undo.")
        return

    # Find the timestamp of the last run
    last_run = None
    undos = []
    for line in reversed(lines):
        try:
            entry = json.loads(line.strip())
            if entry["action"] == "MOVE":
                last_run = entry["timestamp"][:19]  # YYYY-MM-DD
                break
        except (json.JSONDecodeError, KeyError):
            continue

    if not last_run:
        print("No moves found in log. Nothing to undo.")
        return

    # Reverse all moves from that timestamp
    reversed_count = 0
    for line in reversed(lines):
        try:
            entry = json.loads(line.strip())
            if entry["action"] == "MOVE":
                # Move back to original location
                src = Path(entry["source"])
                dst = Path(entry["destination"])
                if dst.exists():
                    dst.parent.mkdir(parents=True, exist_ok=True)
                    shutil.move(str(dst), str(src))
                    log_action("UNDO", dst, src)
                    reversed_count += 1
        except (json.JSONDecodeError, KeyError, OSError):
            continue

    print(f"Reversed {reversed_count} moves.")


def main():
    args = sys.argv[1:]

    if "--undo" in args:
        undo_last_run()
        return

    dry_run = "--dry-run" in args
    initial = "--initial" in args

    if initial:
        print("Running initial cleanup scan...")
    elif dry_run:
        print("Running dry-run scan (no files will be moved)...")
    else:
        print("Running file guardian scan...")

    moves, errors = scan_and_move(dry_run=dry_run, initial=initial)

    print(f"\nResults: {len(moves)} file(s) processed, {len(errors)} error(s)")
    if errors:
        for src, err in errors:
            print(f"  ERROR: {src} → {err}")

    if moves and not dry_run:
        print(f"\nCheck {LOG_FILE} for full audit log.")
    elif moves and dry_run:
        print("\nRun without --dry-run to apply these moves.")


if __name__ == "__main__":
    main()
