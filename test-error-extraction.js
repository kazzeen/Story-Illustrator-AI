// Test script to verify error extraction logic
const { extractDetailedError } = require('./src/lib/error-reporting.ts');

// Test case 1: Venice content violation
const contentViolationCase = {
  status: 400,
  statusText: 'Bad Request',
  headers: {
    'x-venice-is-content-violation': 'true',
    'x-venice-is-blurred': 'false',
    'x-venice-is-adult-model-content-violation': 'false',
    'x-venice-contains-minor': 'false',
    'x-failure-reason': 'Content violates safety guidelines'
  },
  errorBody: 'Content generation failed'
};

console.log('=== Test Case 1: Content Violation ===');
const result1 = extractDetailedError(contentViolationCase);
console.log('Code:', result1.code);
console.log('Title:', result1.title);
console.log('Description:', result1.description);
console.log('Violation Headers:', result1.violationHeaders);
console.log('');

// Test case 2: Multiple violations
const multipleViolationsCase = {
  status: 400,
  headers: {
    'x-venice-is-content-violation': 'true',
    'x-venice-is-adult-model-content-violation': 'true',
    'x-venice-contains-minor': 'false',
    'x-venice-is-blurred': 'true'
  }
};

console.log('=== Test Case 2: Multiple Violations ===');
const result2 = extractDetailedError(multipleViolationsCase);
console.log('Code:', result2.code);
console.log('Title:', result2.title);
console.log('Description:', result2.description);
console.log('Violation Headers:', result2.violationHeaders);
console.log('');

// Test case 3: No violations but headers present
const noViolationsCase = {
  status: 500,
  headers: {
    'x-venice-is-content-violation': 'false',
    'x-venice-is-blurred': 'false',
    'x-error-message': 'Server error occurred'
  },
  errorBody: 'Internal server error'
};

console.log('=== Test Case 3: No Violations ===');
const result3 = extractDetailedError(noViolationsCase);
console.log('Code:', result3.code);
console.log('Title:', result3.title);
console.log('Description:', result3.description);
console.log('Violation Headers:', result3.violationHeaders);