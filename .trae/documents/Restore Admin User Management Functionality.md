I have analyzed the current codebase and database schema. The user management functionality is indeed incomplete.

**Missing Components:**
1.  **Frontend**: No "User Details" page (`AdminUserDetails.tsx`) exists. The list view does not link to any detail view.
2.  **Backend**: The `api-admin` Edge Function only supports listing users (`GET /users`). It lacks endpoints to:
    *   Get a single user's full details (including credit transactions).
    *   Update a user's profile (credits, tier).

**Restoration Plan:**

I will proceed with the following steps to fully restore the user management capabilities:

1.  **Backend Update (`supabase/functions/api-admin/index.ts`)**:
    *   **Add `GET /users/:id`**: Fetch detailed profile data + recent `credit_transactions`.
    *   **Add `PATCH /users/:id`**: Implement logic to update `subscription_tier` and `credits_balance`.
        *   *Note*: Updating credits is complex because of the `user_credits` vs `profiles` sync. I will implement a safe update that modifies `profiles` and lets the system triggers/logic handle the rest, or directly invokes the credit management functions if available. For now, updating `profiles` is the most direct path for admin overrides.

2.  **Frontend Implementation**:
    *   **Create `src/pages/admin/AdminUserDetails.tsx`**:
        *   **Header**: User Avatar, Name, Email, ID.
        *   **Plan Card**: Dropdown to change `subscription_tier` (Free, Starter, Creator, Pro).
        *   **Credits Card**: Input to manually adjust `credits_balance`.
        *   **Activity Log**: A table showing `credit_transactions` (Date, Type, Amount).
    *   **Update `src/pages/admin/AdminUsers.tsx`**: Add a "View" button or clickable row to navigate to `/admin/users/:userId`.
    *   **Update `src/App.tsx`**: Add the route `/admin/users/:userId`.

3.  **Deployment**:
    *   Deploy the updated Edge Function.
    *   Push frontend changes to Vercel.

This will give you full visibility and control over user accounts as requested.
