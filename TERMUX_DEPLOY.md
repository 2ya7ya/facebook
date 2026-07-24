cd ~/facebook || exit 1

ZIP="$HOME/storage/downloads/facebook_picture_quality_duration_frame_effects_fixed.zip"

if [ ! -f "$ZIP" ]; then
  echo "File not found: $ZIP"
  exit 1
fi

unzip -o "$ZIP" -d ~/facebook
npm install

git add .
if git diff --cached --quiet; then
  echo "Nothing new to commit"
else
  git commit -m "Fix picture quality duration fullscreen and frame effects"
  git push origin main
fi

echo "Done"
