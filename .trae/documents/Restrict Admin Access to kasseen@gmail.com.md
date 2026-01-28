## Restrict Admin Access to `kasseen@gmail.com`

I will update the frontend to ensure that the Admin button and the Admin login capabilities are strictly reserved for `kasseen@gmail.com` (and existing admin sessions).

### Plan
1.  **Restrict "Admin" Button (`Navbar.tsx`)**:
    - Update the visibility condition to:
      ```tsx
      {adminEnabled &&
        (adminSession || user?.email === "kasseen@gmail.com") && (
        <Link to="/admin">...</Link>
      )}
      ```
    - This removes the fallback for `admin@siai.com` or generic access, strictly following your request.

2.  **Restrict Admin Login Page (`AdminLogin.tsx`)**:
    - Add a check at the top of the component:
      - If `user` is signed in AND `user.email !== "kasseen@gmail.com"`, render an "Access Denied" message instead of the login form.
      - If `user` is NOT signed in, I will hide the form and show a "Sign in as kasseen@gmail.com to continue" prompt (or just redirect to auth).
    - This effectively blocks the "password login" form for anyone else, enforcing that you must be `kasseen@gmail.com` to even attempt admin access.

3.  **Deploy**:
    - Redeploy to Vercel.

This ensures that only the `kasseen@gmail.com` account can see the button or access the dashboard entry point.