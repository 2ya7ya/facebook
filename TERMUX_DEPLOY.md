cd ~/facebook || exit 1

ZIP="$HOME/storage/downloads/facebook_rotate_button_enabled.zip"

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
  git commit -m "Enable clip rotate button"
  git push origin main
fi

echo "Done"
