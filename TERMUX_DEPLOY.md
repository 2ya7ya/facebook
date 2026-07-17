# Deploy from Termux

## 1. Prepare Termux

```sh
pkg update
pkg install git nodejs gh unzip
termux-setup-storage
```

Extract the downloaded package into a folder named `facebook`:

```sh
mkdir -p ~/facebook
cd ~/facebook
unzip -o ~/storage/downloads/facebook.zip
```

## 2. Push `facebook` to GitHub

Log into GitHub, then create a repository named `facebook` and push the project:

```sh
cd ~/facebook
gh auth login
git init
git add .
git commit -m "Initial website"
git branch -M main
gh repo create facebook --public --source=. --remote=origin --push
```

## 3. Create the Aiven database

Create an Aiven PostgreSQL service. Copy its service URI into `DATABASE_URL` and its CA certificate into `DATABASE_CA_CERT`. Do not commit either value to GitHub.

## 4. Deploy on Render

In Render, choose **New + → Blueprint**, connect the GitHub repository, and select `render.yaml`. Add the two secret environment variables when prompted:

- `DATABASE_URL`
- `DATABASE_CA_CERT`

After deployment, open the Render URL. `/api/health` reports whether Aiven is connected.

## Updating later

```sh
git add .
git commit -m "Update website"
git push
```

Render redeploys automatically after each push.
