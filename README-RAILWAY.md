# Railway + Kaggle Setup Guide

## 1 — Create Railway MySQL database

1. Go to [railway.app](https://railway.app) → **New Project** → **Deploy MySQL**
2. Open the MySQL service → **Variables** tab → copy these values:
   - `MYSQL_HOST`
   - `MYSQL_PORT`
   - `MYSQL_USER`
   - `MYSQLPASSWORD`
   - `MYSQL_DATABASE`
3. Open **Query** tab and paste the contents of [`sql/db.sql`](sql/db.sql) → **Run**

---

## 2 — Configure PHP backend for Railway

Update [`php/config.php`](php/config.php) is already environment-aware.  
Set the Railway MySQL variables as environment variables on your PHP host, **or** hard-code them directly in `config.php` for local use:

```php
define('DB_HOST',  'your-railway-host.railway.app');
define('DB_PORT',  12345);
define('DB_NAME',  'railway');
define('DB_USER',  'root');
define('DB_PASS',  'your-password');
```

---

## 3 — Run the Kaggle ingestion script

### Install dependencies
```bash
pip install kagglehub mysql-connector-python
```

### Set up Kaggle credentials
Download your `kaggle.json` API token from [kaggle.com/account](https://www.kaggle.com/account) and place it at:
- **Linux/macOS:** `~/.kaggle/kaggle.json`
- **Windows:** `C:\Users\<you>\.kaggle\kaggle.json`

Or export as environment variables:
```bash
export KAGGLE_USERNAME=your_username
export KAGGLE_KEY=your_api_key
```

### Set Railway DB credentials as env vars
```bash
# Windows PowerShell
$env:MYSQL_HOST     = "your-host.railway.app"
$env:MYSQL_PORT     = "12345"
$env:MYSQL_USER     = "root"
$env:MYSQLPASSWORD  = "your-password"
$env:MYSQL_DATABASE = "railway"

# Linux / macOS
export MYSQL_HOST=your-host.railway.app
export MYSQL_PORT=12345
export MYSQL_USER=root
export MYSQLPASSWORD=your-password
export MYSQL_DATABASE=railway
```

### Run
```bash
# Preview without writing anything
python python/ingest.py --dry-run

# Ingest first 50 images to test
python python/ingest.py --limit 50

# Full ingest
python python/ingest.py
```

### Output
```
📥  Downloading dataset: akhilchibber/deforestation-detection-dataset
✅  Dataset path: /root/.cache/kagglehub/...

✅  Connected to MySQL @ your-host.railway.app:12345 → railway

  [    1] id=1        Amazon_forest_001.jpg
  [    2] id=2        Borneo_clearcut_014.jpg
  ...

──────────────────────────────────────────────────
  Inserted   : 842
  Duplicates : 0
  Non-image  : 12
  Errors     : 0
──────────────────────────────────────────────────
```

---

## 4 — Connect the web app to Railway

Point the PHP app at Railway MySQL by setting the env vars on your hosting
provider, or by editing [`php/config.php`](php/config.php) directly.

Images ingested by the Python script will appear as `status='pending'` rows,
and will be picked up automatically the next time **Auto Monitor** polls
`api.php?action=get_pending`.

---

## File structure

```
/forest-monitor/
  python/
    ingest.py          ← Kaggle → MySQL ingestion script
  php/
    config.php         ← Railway env-var aware DB config
    api.php
  sql/
    db.sql             ← Schema v3 (file_hash + expanded status)
  uploads/
    satellite/         ← Images copied here by ingest.py
```

---

## Schema changes in v3

| Table | New column | Purpose |
|---|---|---|
| `satellite_media` | `file_hash CHAR(32) UNIQUE` | MD5 deduplication |
| `satellite_media` | `status` enum expanded | adds `processing` and `failed` |
