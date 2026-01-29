# Vercel Deployment Reset Guide

If the website still appears "broken" or is not updating to v3.0, follow these steps to force a complete rebuild from scratch.

## Step 1: Force Redeploy without Cache

1.  Go to your **Vercel Dashboard** (vercel.com).
2.  Select the **Story Illustrator AI** project.
3.  Click on the **Deployments** tab.
4.  Find the most recent deployment (the one I just pushed).
5.  Click the **three dots (...)** menu on the right side of that deployment.
6.  Select **Redeploy**.
7.  **CRITICAL**: In the popup, check the box that says **"Redeploy with existing build cache"** to UNCHECK IT? 
    *   *Correction*: Vercel UI has changed. Look for **"Redeploy"** -> Uncheck "Use Build Cache" if available.
    *   **BETTER METHOD**:
        1.  Go to **Deployments**.
        2.  Click **Redeploy** on the latest commit.
        3.  UNCHECK **"Use existing build cache"**.
        4.  Click **Redeploy**.

## Step 2: Verify Environment Variables

If the site loads but shows a Red Error Box, it means your keys are missing.

1.  Go to **Settings** > **Environment Variables**.
2.  Ensure `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are present for the **Production** environment.

## Step 3: Hard Refresh

Once redeployed:
1.  Open your site.
2.  Press `Ctrl + Shift + R` (Windows) or `Cmd + Shift + R` (Mac) to clear your browser cache.
3.  Look for **v3.0-RESET** in the top navigation bar.
