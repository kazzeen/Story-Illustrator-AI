## Fix Admin Dashboard Visibility for kasseen@gmail.com

The issue is that while the SSO capability exists, the **entry point (Admin link)** is hidden because the system waits for you to *already* be an admin before showing it.

I will fix this by:
1.  **Updating the Navbar**: Force the "Admin" link to appear for `kasseen@gmail.com` (and `admin@siai.com`) even if you haven't completed the admin login yet.
2.  **Automating the Login**: When you visit `/admin/login` as `kasseen@gmail.com`, I will make it **automatically** trigger the "Continue as..." flow so you don't have to click the button manually.

### Implementation Steps
1.  **Edit `src/components/layout/Navbar.tsx`**:
    - Update the visibility condition for the Admin button:
      ```tsx
      const showAdminLink = adminSession || 
        user?.email === "kasseen@gmail.com" || 
        user?.email === "admin@siai.com";
      ```
2.  **Edit `src/pages/admin/AdminLogin.tsx`**:
    - Add an auto-login effect:
      ```tsx
      useEffect(() => {
        if (user?.email === "kasseen@gmail.com" && !session && !submitting) {
          onSso();
        }
      }, [user, session]);
      ```
3.  **Deploy**:
    - Redeploy the frontend to Vercel so the changes take effect on the live site.

This will make the "Admin" link visible immediately after you sign in as `kasseen@gmail.com`, and clicking it will seamlessly log you into the dashboard.