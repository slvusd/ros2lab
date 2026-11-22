# =============================================================================
# env.sh — activate the ROS 2 Jazzy environment in the CURRENT terminal
# =============================================================================
# USE:   source scripts/env.sh        (do NOT run it; it must be sourced)
# Needed once per new terminal window. Changes only this terminal session.
# =============================================================================
if ! command -v micromamba >/dev/null 2>&1; then
  echo "micromamba not found - run scripts/00_install_micromamba.sh" >&2
  return 1 2>/dev/null || exit 1
fi
export MAMBA_ROOT_PREFIX="${MAMBA_ROOT_PREFIX:-$HOME/micromamba}"
eval "$(micromamba shell hook -s "$(basename "${SHELL:-zsh}")")"
micromamba activate ros_jazzy
echo "ROS 2 env active: ROS_DISTRO=${ROS_DISTRO:-<unset>}"
