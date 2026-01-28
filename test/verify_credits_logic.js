
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import process from 'process';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env or environment variables.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const TEST_USER_ID = process.env.TEST_USER_ID;

async function runTest() {
  console.log('--- Starting Credit System Logic Verification ---');

  let userId = TEST_USER_ID;

  if (!userId) {
    console.log('No TEST_USER_ID provided. Searching for a user...');
    // Try to find a user with credits
    const { data: users, error } = await supabase.from('user_credits').select('user_id').limit(1);
    if (error || !users || users.length === 0) {
       console.error('Could not find any user in user_credits table.', error);
       process.exit(1);
    }
    userId = users[0].user_id;
    console.log(`Using user_id: ${userId}`);
  }

  // 1. Get Initial Balance
  const { data: initialCredits, error: initialErr } = await supabase
    .from('user_credits')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (initialErr) {
    console.error('Failed to fetch initial credits:', initialErr);
    process.exit(1);
  }

  const initialTotal = 
    (initialCredits.monthly_credits_per_cycle - initialCredits.monthly_credits_used - (initialCredits.reserved_monthly || 0)) + 
    (initialCredits.bonus_credits_total - initialCredits.bonus_credits_used - (initialCredits.reserved_bonus || 0));
  
  console.log(`Initial Balance: ${initialTotal}`);

  if (initialTotal < 2) {
    console.error('Not enough credits to run test. Need at least 2 credits.');
    process.exit(1);
  }

  // 2. Test Success Flow
  console.log('\n--- Testing Success Flow (Reserve -> Commit) ---');
  const requestId1 = crypto.randomUUID();
  console.log(`Reserving 1 credit (Request ID: ${requestId1})...`);

  const { data: res1, error: resErr1 } = await supabase.rpc('reserve_credits', {
    p_user_id: userId,
    p_amount: 1,
    p_request_id: requestId1,
    p_feature: 'test_feature',
    p_metadata: { test: true }
  });

  if (resErr1 || !res1 || res1.ok !== true) {
    console.error('Reservation 1 failed:', resErr1 || res1);
    process.exit(1);
  }
  console.log('Reservation successful.');

  console.log('Committing 1 credit...');
  const { data: com1, error: comErr1 } = await supabase.rpc('commit_reserved_credits', {
    p_user_id: userId,
    p_request_id: requestId1
  });

  if (comErr1 || !com1 || com1.ok !== true) {
    console.error('Commit 1 failed:', comErr1 || com1);
    process.exit(1);
  }
  console.log('Commit successful.');

  // Check balance
  const { data: afterCommit } = await supabase
    .from('user_credits')
    .select('*')
    .eq('user_id', userId)
    .single();

  const commitTotal = 
    (afterCommit.monthly_credits_per_cycle - afterCommit.monthly_credits_used - (afterCommit.reserved_monthly || 0)) + 
    (afterCommit.bonus_credits_total - afterCommit.bonus_credits_used - (afterCommit.reserved_bonus || 0));

  console.log(`Balance after commit: ${commitTotal}`);
  if (initialTotal - 1 !== commitTotal) {
    console.error(`Balance mismatch! Expected ${initialTotal - 1}, got ${commitTotal}`);
    process.exit(1);
  }

  // 3. Test Failure Flow
  console.log('\n--- Testing Failure Flow (Reserve -> Refund) ---');
  const requestId2 = crypto.randomUUID();
  console.log(`Reserving 1 credit (Request ID: ${requestId2})...`);

  const { data: res2, error: resErr2 } = await supabase.rpc('reserve_credits', {
    p_user_id: userId,
    p_amount: 1,
    p_request_id: requestId2,
    p_feature: 'test_feature',
    p_metadata: { test: true }
  });

  if (resErr2 || !res2 || res2.ok !== true) {
    console.error('Reservation 2 failed:', resErr2 || res2);
    process.exit(1);
  }
  console.log('Reservation successful.');

  console.log('Refunding 1 credit (simulating failure)...');
  const { data: ref2, error: refErr2 } = await supabase.rpc('force_refund_credits', {
    p_user_id: userId,
    p_request_id: requestId2,
    p_reason: 'Test failure refund',
    p_metadata: { test: true }
  });

  if (refErr2 || !ref2 || ref2.ok !== true) {
    console.error('Refund failed:', refErr2 || ref2);
    process.exit(1);
  }
  console.log('Refund successful.');

  // Check balance
  const { data: afterRefund } = await supabase
    .from('user_credits')
    .select('*')
    .eq('user_id', userId)
    .single();

  const refundTotal = 
    (afterRefund.monthly_credits_per_cycle - afterRefund.monthly_credits_used - (afterRefund.reserved_monthly || 0)) + 
    (afterRefund.bonus_credits_total - afterRefund.bonus_credits_used - (afterRefund.reserved_bonus || 0));

  console.log(`Balance after refund: ${refundTotal}`);
  if (commitTotal !== refundTotal) {
    console.error(`Balance mismatch! Expected ${commitTotal}, got ${refundTotal}`);
    process.exit(1);
  }

  console.log('\n--- TEST PASSED SUCCESSFULLY ---');
  console.log('Note: 1 credit was consumed in the success flow test.');
}

runTest();
