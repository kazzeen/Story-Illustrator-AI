declare module "https://deno.land/std@0.168.0/http/server.ts" {
  export const serve: (...args: unknown[]) => unknown;
}

declare module "https://esm.sh/@supabase/supabase-js@2.49.2" {
  export const createClient: (...args: unknown[]) => unknown;
}

declare module "https://deno.land/std@0.168.0/encoding/base64.ts" {
  export const encode: (data: Uint8Array) => string;
  export const decode: (text: string) => Uint8Array;
}

declare module "https://deno.land/x/imagescript@1.3.0/mod.ts" {
  export const Image: unknown;
}
