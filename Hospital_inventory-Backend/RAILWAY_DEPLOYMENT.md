# Railway Deployment Guide

## Issues Fixed
This guide addresses the "railpack process exited with an error" deployment failure.

## What Was Changed
1. ✅ Added `.nvmrc` file specifying Node.js version 18.17.0
2. ✅ Added `.railwayignore` to exclude unnecessary files
3. ✅ Removed hardcoded database credentials from `config.js`
4. ✅ Updated `index.js` to listen on `0.0.0.0` (required for Railway)
5. ✅ Added `engines` field to `package.json` for Node version specification
6. ✅ Simplified `Procfile` for proper Railway execution
7. ✅ Updated `railway.json` with proper builder configuration

## Required Environment Variables

Set these variables in your Railway project settings before deploying:

### Database Configuration
```
DB_HOST=your-database-host
DB_PORT=your-database-port
DB_USER=your-database-user
DB_PASSWORD=your-database-password
DB_NAME=your-database-name
```

### Cloudinary Configuration
```
CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_API_KEY=your-api-key
CLOUDINARY_API_SECRET=your-api-secret
```

### Optional
```
NODE_ENV=production
PORT=3000
```

## Deployment Steps

### Step 1: Set Environment Variables in Railway
1. Open your Railway project dashboard
2. Go to your **Hospital_Inventory_API** service
3. Click on the **Variables** tab
4. Add ALL the environment variables listed above
5. Save and redeploy

### Step 2: Push Code Changes
```bash
git add -A
git commit -m "Fix Railway deployment configuration"
git push
```

### Step 3: Trigger Deployment
1. Go to your Railway dashboard
2. Click on **Hospital_Inventory_API** project
3. Click the **Deploy** button to manually trigger a build
4. Wait for the build to complete (watch the logs in Build Logs tab)

## Troubleshooting

### If build still fails:
1. **Check Build Logs**: Click "Build Logs" tab in Railway to see exact error
2. **Verify Environment Variables**: Ensure ALL required variables are set
3. **Check Deploy Logs**: Click "Deploy Logs" tab to see runtime errors

### Common Issues:
- **"Cannot find module"**: Missing environment variable causing connection failure
- **"Port already in use"**: Railway automatically assigns PORT variable
- **"Connection timeout"**: Database host/credentials incorrect

## Testing Locally
Before deploying, test locally:
```bash
# Install dependencies
npm install

# Create .env file with your credentials
cp .env.example .env

# Start the server
npm start
```

## Success Indicators
✅ Build completes without errors
✅ Server logs show "🚀 Server is running on port 3000"
✅ Database connection shows "✅ Database connected successfully"
✅ API is accessible at your Railway domain

## Support
If deployment still fails:
1. Share the **Build Logs** output
2. Share the **Deploy Logs** output
3. Verify all environment variables are correctly set
