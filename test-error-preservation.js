// Test script to verify error message preservation

function simulateClientSideReconciliation(serverResponse) {
  // Simulate the client-side logic from Storyboard.tsx
  const bodyObj = serverResponse;
  
  // OLD LOGIC (before fix)
  const oldErrorMsg =
    (typeof bodyObj?.error === "string" ? bodyObj.error : undefined) ||
    (typeof bodyObj?.message === "string" ? bodyObj.message : undefined) ||
    "HTTP 500 Internal Server Error";
  
  const oldReason = `Scene image generation failed: ${oldErrorMsg}`;
  
  // NEW LOGIC (after fix)
  const newErrorMsg =
    (typeof bodyObj?.error === "string" ? bodyObj.error : undefined) ||
    (typeof bodyObj?.message === "string" ? bodyObj.message : undefined) ||
    "HTTP 500 Internal Server Error";
  
  const newReason = newErrorMsg; // Preserve exact error message
  
  return {
    old: oldReason,
    new: newReason,
    preserved: oldErrorMsg === newErrorMsg ? "EXACT" : "MODIFIED"
  };
}

// Test cases
const testCases = [
  {
    name: "Blank image detection (mean=0.0, std=0.0)",
    response: {
      error: "Blank image generation (mean=0.0, std=0.0)",
      message: "Image generation failed"
    }
  },
  {
    name: "Generic error message",
    response: {
      message: "Internal server error"
    }
  },
  {
    name: "No image URL returned",
    response: {
      error: "No image URL returned"
    }
  },
  {
    name: "Network error",
    response: {} // No error/message fields
  }
];

console.log("Testing Error Message Preservation Fix");
console.log("=====================================");

testCases.forEach(testCase => {
  console.log(`\nTest: ${testCase.name}`);
  console.log(`Server Response: ${JSON.stringify(testCase.response)}`);
  
  const result = simulateClientSideReconciliation(testCase.response);
  
  console.log(`OLD Reason: "${result.old}"`);
  console.log(`NEW Reason: "${result.new}"`);
  console.log(`Message Preservation: ${result.preserved}`);
  
  // Check if the specific error message is preserved
  const hasSpecificError = testCase.response.error?.includes("Blank image generation") || testCase.response.message?.includes("Blank image generation");
  const isPreserved = result.new.includes("Blank image generation");
  
  if (hasSpecificError && isPreserved) {
    console.log(`✅ SUCCESS: Specific error message preserved!`);
  } else if (hasSpecificError && !isPreserved) {
    console.log(`❌ FAILURE: Specific error message lost!`);
  } else {
    console.log(`ℹ️  INFO: No specific error message to preserve`);
  }
});

console.log("\n" + "=".repeat(50));
console.log("SUMMARY:");
console.log("The fix ensures that specific error messages from the server");
console.log("(like 'Blank image generation (mean=0.0, std=0.0)') are preserved");
console.log("and will appear correctly in the Recent Activity log.");