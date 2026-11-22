#!/usr/bin/env bash
# =============================================================================
# 00_install_micromamba.sh — install micromamba (a tiny conda-compatible tool)
# =============================================================================
# WHAT THIS DOES
#   Runs `brew install micromamba`. That's all.
#
# WHAT IS micromamba?
#   A single small program that creates ISOLATED software environments
#   (conda-style). ROS 2 on macOS comes from RoboStack as conda packages, so we
#   need a conda-compatible tool to install it.
#
# WHAT IT CHANGES
#   - Installs one Homebrew package (`micromamba`) into /opt/homebrew.
#   - Does NOT edit your ~/.zshrc, ~/.condarc, or any shell startup file.
#   - Environments will live in ~/micromamba (our scripts set MAMBA_ROOT_PREFIX; brew's
#     "shell init" message printed at the end can be ignored).
#
# UNDO
#   brew uninstall micromamba; rm -rf ~/micromamba
#
# SAFE TO RE-RUN: yes (skips if already installed).
# =============================================================================
set -euo pipefail

if command -v micromamba >/dev/null 2>&1; then
  echo "micromamba already installed: $(command -v micromamba) ($(micromamba --version))"
  exit 0
fi

command -v brew >/dev/null 2>&1 || { echo "Homebrew not found. Install it from https://brew.sh first." >&2; exit 1; }

echo "Installing micromamba via Homebrew..."
brew install micromamba
echo "Done: $(micromamba --version)"
