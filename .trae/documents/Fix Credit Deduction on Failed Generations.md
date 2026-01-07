I have identified the issues causing credit leaks and credit deduction on failures. I will implement a comprehensive fix that ensures credits are released or refunded in all failure scenarios.

### **1. Fix Credit Leaks in `generate-scene-image`**
I will modify `supabase/functions/generate-scene-image/index.ts` to close the identified gaps where the function returns an error without releasing reserved credits.

*   **Fix Strict Style Validation Leak:**
    *   **Action:** Insert `await releaseReservationIfNeeded(...)` before the `return json(400, ...)` block when style validation fails.
*   **Fix Empty Prompt Leak:**
    *   **Action:** Insert `await releaseReservationIfNeeded(...)` before the `return json(400, ...)` block when `forceFullPrompt` is empty.
*   **Global Safety Net:**
    *   **Action:** Verify the top-level `try/catch` block correctly handles unexpected errors and calls `releaseReservationIfNeeded` if `creditsReserved` is still true.

### **2. Enhance Client-Side Validation & Refund**
I will ensure the frontend `Storyboard.tsx` has robust checks to refund credits if the generated image is invalid (e.g., blank, corrupted).

*   **Validation Check:** Verify `validateGeneratedImage` is called immediately after generation.
*   **Refund Trigger:** Ensure `refundConsumedCredits` is called if validation fails, with a clear reason logged (e.g., "Client validation failed: blank image").

### **3. Audit Logging Verification**
The system already logs financial transactions (`credit_transactions`) and operational attempts (`image_generation_attempts`). I will ensure the new failure paths correctly update these logs:
*   **Action:** Ensure `releaseReservationIfNeeded` updates the `image_generation_attempts` status to `failed` and records the `error_stage`.

### **4. Add Unit Tests**
I will add tests to `supabase/functions/_shared/credits.test.ts` to verify the fix.
*   **Test Case 1:** `should_release_credits_on_validation_failure` - Mocks a failure and asserts that `release_reserved_credits` is called.
*   **Test Case 2:** `should_refund_credits_on_client_rejection` - Verifies the refund logic flow.

**Files to Modify:**
*   `supabase/functions/generate-scene-image/index.ts` (Fix leaks)
*   `src/pages/Storyboard.tsx` (Verify/Enhance client validation)
*   `supabase/functions/_shared/credits.test.ts` (Add tests)
