/* eslint-disable @typescript-eslint/no-explicit-any */
declare module "https://deno.land/std@0.168.0/http/server.ts" {
  export function serve(
    handler: (req: Request) => Response | Promise<Response>,
    options?: unknown
  ): void;
}

declare module "https://esm.sh/@supabase/supabase-js@2.49.2" {
  type PostgrestResult = { data: any; error: any; count: any };

  type PostgrestBuilderLike = {
    select(...args: unknown[]): PostgrestBuilderLike;
    eq(...args: unknown[]): PostgrestBuilderLike;
    in(...args: unknown[]): PostgrestBuilderLike;
    order(...args: unknown[]): PostgrestBuilderLike;
    limit(...args: unknown[]): PostgrestBuilderLike;
    update(...args: unknown[]): PostgrestBuilderLike;
    upsert(...args: unknown[]): PostgrestBuilderLike;
    insert(...args: unknown[]): PostgrestBuilderLike;
    delete(...args: unknown[]): PostgrestBuilderLike;
    maybeSingle(...args: unknown[]): Promise<PostgrestResult>;
    single(...args: unknown[]): Promise<PostgrestResult>;
    then<TResult1 = PostgrestResult, TResult2 = never>(
      onfulfilled?: ((value: PostgrestResult) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
    ): PromiseLike<TResult1 | TResult2>;
  };

  type StorageBucketLike = {
    upload(...args: unknown[]): Promise<{ data?: any; error?: any }>;
    getPublicUrl(...args: unknown[]): { data: { publicUrl: string } };
  };

  type StorageLike = {
    from(bucket: string): StorageBucketLike;
  };

  type AuthLike = {
    getUser(...args: unknown[]): Promise<{ data: { user: any }; error: any }>;
  };

  type SupabaseClientLike = {
    auth: AuthLike;
    from(table: string): PostgrestBuilderLike;
    storage: StorageLike;
  };

  export function createClient(url: string, key: string, options?: unknown): SupabaseClientLike;
}

declare module "https://deno.land/std@0.168.0/testing/asserts.ts" {
  export function assertEquals(actual: unknown, expected: unknown, msg?: string): void;
  export function assertMatch(actual: string, expected: RegExp, msg?: string): void;
}

declare const Deno: {
  env: {
    get(key: string): string | undefined;
  };
  test(name: string, fn: () => void | Promise<void>): void;
  test(options: { name: string; fn: () => void | Promise<void>; [key: string]: any }): void;
};
