#!/data/data/com.termux/files/usr/bin/bash
set -eu

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SOURCE_DIR="$PROJECT_ROOT/android/termux-widget"
CONFIG_DIR="$HOME/.config/quizora"
SHORTCUTS_DIR="$HOME/.shortcuts"
TASKS_DIR="$SHORTCUTS_DIR/tasks"

if [ ! -f "$SOURCE_DIR/start_quizora" ] || [ ! -f "$SOURCE_DIR/stop_quizora" ]; then
    echo "Android shortcut scripts are missing from $SOURCE_DIR." >&2
    exit 1
fi

mkdir -p "$CONFIG_DIR" "$TASKS_DIR"
chmod 700 "$CONFIG_DIR" "$SHORTCUTS_DIR" "$TASKS_DIR"
printf '%s\n' "$PROJECT_ROOT" > "$CONFIG_DIR/project_dir"
chmod 600 "$CONFIG_DIR/project_dir"

cp "$SOURCE_DIR/start_quizora" "$TASKS_DIR/Start QUIZORA"
cp "$SOURCE_DIR/stop_quizora" "$TASKS_DIR/Stop QUIZORA"
chmod 700 "$TASKS_DIR/Start QUIZORA" "$TASKS_DIR/Stop QUIZORA"

echo "Installed Start QUIZORA and Stop QUIZORA in Termux:Widget."
echo "Add or refresh the Termux:Widget home-screen widget to see them."
